import { fork } from "child_process";
import fs from "fs";
import path from "path";
import Logger from "strike-discord-framework/dist/logger.js";

import { Application, KILLS_TO_RANK } from "../application.js";
import { shouldUserBeBanned } from "../banHandler.js";
import {
	Aircraft,
	AircraftCategory,
	aircraftCategoryMap,
	Death,
	isKillValid,
	Kill,
	Season,
	User,
	Weapon,
	WeaponCategory,
	weaponCategoryMap
} from "../structures.js";
import { IPCMessage } from "./eloBackUpdater.js";

// ELO CONFIG:

// Starting elo
const BASE_ELO = 2000;
// Normal kill takes 10 points
export const baseEloStealPoints = 10;
// Always take at least 0.1 points
export const minEloStealPoints = 0.1;
// Take at most 150 points
export const maxEloStealPoints = 150;
// For every 100 points apart, take 1 point more, assuming the victim has more ELO than the killer
export const stealPerEloGainedPoints = 1 / 100;
// For every 100 points apart, take 0.5 points less, assuming the victim has less ELO than the killer
export const stealPerEloLostPoints = 0.5 / 100;
// Loose 0% of ELO for a team kill
export const teamKillPenalty = 0.0;
// Loose 25 points if you die to a T-55
export const t55Penalty = 25;
// Only loose elo from a t55 if above 2500 elo
export const t55PenaltyThreshold = 2500;
// Maximum multiplier for an aircraft/weapon combo (limited by maxEloStealPrec)
export const maxWeaponMultiplier = Infinity;
// Aircraft specific bonuses/nerfs to correct for balance
export const aircraftBonusMults: Record<Aircraft, { killMult: number; deathMult: number }> = {
	[Aircraft.AV42c]: { killMult: 0, deathMult: 0 },
	[Aircraft.FA26b]: { killMult: 1, deathMult: 1 },
	[Aircraft.F45A]: { killMult: 1, deathMult: 1 },
	[Aircraft.AH94]: { killMult: 0, deathMult: 0 },
	[Aircraft.T55]: { killMult: 1.5, deathMult: 0.9 },
	[Aircraft.EF24G]: { killMult: 1, deathMult: 0.8 },
	[Aircraft.Invalid]: { killMult: 0, deathMult: 0 }
};

const hourlyReportPath = "../hourlyReport/";

type KillString = `${string}->${string}->${string}`;
type UserLogsObj = Record<string, string>;
interface KillMetric {
	killStr: KillString;
	count: number;
	prec: number;
	multiplier: number;
}

function getKillStr(kill: Kill) {
	const killerCat = AircraftCategory[aircraftCategoryMap[kill.killer.type]];
	const victimCat = AircraftCategory[aircraftCategoryMap[kill.victim.type]];
	const weaponCat = WeaponCategory[weaponCategoryMap[kill.weapon]];

	return `${killerCat}->${weaponCat}->${victimCat}`;
}

const maxCfitDist = 20 * 1852;
const maxCfitDistSq = maxCfitDist * maxCfitDist;

function shouldKillBeCounted(kill: Kill, killerUser?: User, victimUser?: User) {
	// If invalid, ignore
	if (!isKillValid(kill)) return false;

	// If CFIT, check distance
	if (kill.weapon == Weapon.CFIT) {
		const dist = Math.pow(kill.killer.position.x - kill.victim.position.x, 2) + Math.pow(kill.killer.position.z - kill.victim.position.z, 2);

		if (dist > maxCfitDistSq) return false;
	}

	return true;
}

function shouldDeathBeCounted(death: Death, kill?: Kill) {
	// If invalid, ignore
	if (kill && !isKillValid(kill)) return false;

	// If CFIT, check distance
	if (kill && kill.weapon == Weapon.CFIT) {
		const dist = Math.pow(kill.killer.position.x - kill.victim.position.x, 2) + Math.pow(kill.killer.position.z - kill.victim.position.z, 2);

		if (dist > maxCfitDistSq) return false;
	}

	return true;
}

function userCanRank(user: User) {
	return !user.isBanned && user.kills >= KILLS_TO_RANK;
}

class ELOUpdater {
	private log: Logger;

	public lastMultipliers: KillMetric[] = [];
	public activeSeason: Season;

	constructor(private app: Application) {
		this.log = app.log;
	}

	public async getUserLog(userId: string, season: Season, extraText: string) {
		const log = await this.getUserLogText(userId, season);
		if (!fs.existsSync("../userLogs")) fs.mkdirSync("../userLogs");
		fs.writeFileSync(`../userLogs/${userId}-S${season.id}.txt`, log + extraText);
		return path.resolve(`../userLogs/${userId}-S${season.id}.txt`);
	}

	public async getUserLogText(userId: string, season: Season) {
		const user = await this.app.users.get(userId);
		if (!user) return "No data (user not found)";
		if (season.active) return user.history.join("\n") ?? "No data";
		return user.endOfSeasonStats.find(s => s.season == season.id)?.history ?? "No data (user joined after season end)";
	}

	public async init() {
		this.activeSeason = await this.app.getActiveSeason();
	}

	public getMultiplier(str: KillString) {
		const metric = this.lastMultipliers.find(m => m.killStr == str);
		return metric?.multiplier ?? 1;
	}

	private checkSpawns() {
		const file = fs.readFileSync(`../log.txt`, "ascii");
		const lines = file.split("\n");
		const spawns: Record<string, number> = {};
		lines.forEach((line, idx) => {
			if (line.includes("has spawned in with entity ID")) {
				const nextLine = lines[idx + 1];
				const name = line.split(" (")[0];
				const playerId = line.split(" (")[1].split(")")[0];
				const entityId = line.split("entity ID ")[1].replace("(", "").replace(")", "");
				if (entityId == "-1") return;

				const aircraftIdx = nextLine.indexOf(" - Found Entity: ") + " - Found Entity: ".length;
				const aircraft = nextLine.slice(aircraftIdx, nextLine.indexOf(" ", aircraftIdx));

				// console.log(`${name} (${playerId}) spawned in ${aircraft} (${entityId})`);
				spawns[aircraft] = (spawns[aircraft] || 0) + 1;
			}
		});

		console.log(spawns);
	}

	public async runHourlyTasks() {
		this.log.info(`Running hourly tasks...`);
		await this.writeHourlyReport();

		const start = Date.now();
		const backUpdateProcess = fork("./elo/eloBackUpdater.js", { stdio: ["pipe", "pipe", "pipe", "ipc"] });

		backUpdateProcess.on("spawn", () => {
			this.log.info(`Started eloBackUpdater process`);
			backUpdateProcess.send("start");
		});

		backUpdateProcess.on("message", (message: IPCMessage) => {
			if (message.type == "mults") {
				this.lastMultipliers = message.mults;
				this.log.info(`Received ${message.mults.length} multipliers from eloBackUpdater process`);
			} else if (message.type == "users") {
			}
		});

		backUpdateProcess.stdout.on("data", data => {
			(data.toString() as string)
				.split("\n")
				.filter(l => l.length > 0)
				.forEach(l => this.log.info(`[BackUpdater] ${l}`));
		});

		backUpdateProcess.stderr.on("data", data => {
			(data.toString() as string)
				.split("\n")
				.filter(l => l.length > 0)
				.forEach(l => this.log.error(`[BackUpdater] ${l}`));
		});

		const retCode = await new Promise(res => backUpdateProcess.on("exit", code => res(code)));
		this.log.info(`eloBackUpdater process finished with code ${retCode} in ${Date.now() - start}ms`);
	}

	public static checkInvalidUsers(users: User[]) {
		const valid = new Set<string>();
		const invalid: string[] = [];
		users.forEach(u => {
			if (valid.has(u.id)) {
				// @ts-ignore
				console.log(`Duplicate user: ${u.id} (${u._id})`);
				// @ts-ignore
				invalid.push(u._id);
			} else {
				valid.add(u.id);
			}
		});
		return invalid;
	}

	private async writeHourlyReport() {
		if (!fs.existsSync(hourlyReportPath)) fs.mkdirSync(hourlyReportPath);
		if (fs.existsSync(`${hourlyReportPath}/kills.json`)) fs.rmSync(`${hourlyReportPath}/kills.json`);
		if (fs.existsSync(`${hourlyReportPath}/deaths.json`)) fs.rmSync(`${hourlyReportPath}/deaths.json`);
		const activeSeason = await this.app.getActiveSeason();
		this.log.info(`Writing hourly report to ${hourlyReportPath} for season ${activeSeason.id}`);
		if (!activeSeason) throw new Error("No active season found!");

		const killsStream = fs.createWriteStream(`${hourlyReportPath}/kills.json`);
		const deathsStream = fs.createWriteStream(`${hourlyReportPath}/deaths.json`);
		const proms = [new Promise(res => killsStream.on("finish", res)), new Promise(res => deathsStream.on("finish", res))];

		this.app.kills.collection
			.find({})
			.stream()
			.on("data", kill => killsStream.write(JSON.stringify(kill) + "\n"))
			.on("end", () => killsStream.end());
		this.app.deaths.collection
			.find({})
			.stream()
			.on("data", death => deathsStream.write(JSON.stringify(death) + "\n"))
			.on("end", () => deathsStream.end());

		await Promise.all(proms);

		this.log.info(`Wrote hourly report finished!`);
	}

	public static updateUserLogForKill(
		timestamp: string,
		killer: User,
		victim: User,
		metric: KillMetric,
		kill: Kill,
		eloSteal: number,
		multStr: string,
		extraInfo: string = ""
	) {
		// const killerAc = Aircraft[kill.killer.type];
		// const victimAc = Aircraft[kill.victim.type];
		const wpnStr = `${Aircraft[kill.killer.type]}->${Weapon[kill.weapon]}->${Aircraft[kill.victim.type]}`;
		killer.history.push(
			`[${timestamp}] Kill ${victim.pilotNames[0]} (${Math.round(victim.elo)}) with ${wpnStr} (${metric?.multiplier.toFixed(
				1
			)}) ${extraInfo} Elo gained: ${Math.round(eloSteal)}. New Elo: ${Math.round(killer.elo)}`
		);
		victim.history.push(
			`[${timestamp}] Death to ${killer.pilotNames[0]} (${Math.round(killer.elo)}) with ${wpnStr} (${metric?.multiplier.toFixed(
				1
			)}) ${extraInfo} Elo lost: ${Math.round(eloSteal)}. New Elo: ${Math.round(victim.elo)}`
		);
	}

	public static updateUserLogForDeath(timestamp: string, victim: User, eloSteal: number) {
		victim.history.push(`[${timestamp}] Death (unknown) Elo lost: ${Math.round(eloSteal)}. New Elo: ${Math.round(victim.elo)}`);
	}

	public static updateUserLogForTK(timestamp: string, killer: User, victim: User, eloSteal: number) {
		killer.history.push(`[${timestamp}] Teamkill ${victim.pilotNames[0]} Elo lost: ${Math.round(eloSteal)}. New Elo: ${Math.round(killer.elo)}`);
		victim.history.push(`[${timestamp}] Death to teamkill from ${killer.pilotNames[0]} no elo lost`);
	}

	public static updateUserLogForT55(timestamp: string, killer: User, victim: User, eloSteal: number) {
		killer.history.push(`[${timestamp}] Kill ${victim.pilotNames[0]} with T-55 (no elo gained)`);
		victim.history.push(`[${timestamp}] Death from ${killer.pilotNames[0]} with T-55 lost ${eloSteal} elo`);
	}

	public static updateUserLogForCollision(timestamp: string, killer: User, victim: User) {
		// We assume the collision kill with be emitted for both users, to only log once check higher userId
		if (killer.id < victim.id) return;
		killer.history.push(`[${timestamp}] Collision with ${victim.pilotNames[0]}`);
		victim.history.push(`[${timestamp}] Collision with ${killer.pilotNames[0]}`);
	}

	public async updateELOForKill(kill: Kill) {
		const killer = await this.app.users.get(kill.killer.ownerId);
		const victim = await this.app.users.get(kill.victim.ownerId);

		if (!killer) {
			this.log.error(`Killer ${kill.killer.ownerId} not found!`);
			return;
		}

		if (!victim) {
			this.log.error(`Victim ${kill.victim.ownerId} not found!`);
			return;
		}

		if (kill.weapon == Weapon.Collision) {
			this.log.info(`User ${killer.pilotNames[0]} collided with ${victim.pilotNames[0]}`);
			ELOUpdater.updateUserLogForCollision(new Date().toISOString(), killer, victim);

			return {
				killer: killer,
				victim: victim,
				eloSteal: 0
			};
		}

		if (kill.killer.team == kill.victim.team) {
			this.log.info(`User ${killer.pilotNames[0]} killed a teammate! Applying ELO penalty.`);
			const loss = await this.updateELOForTeamKill(killer, victim);
			return {
				killer: killer,
				victim: killer,
				eloSteal: loss,
				eloStealPrec: 0
			};
		}

		if (!shouldKillBeCounted(kill, killer, victim)) return;

		const killStr = getKillStr(kill);
		let metric = this.lastMultipliers.find(m => m.killStr == killStr);
		let info = "";

		if (kill.weapon == Weapon.CFIT) {
			const { cfitMetric, extraInfo } = ELOUpdater.getCFITMultiplier(kill, this.lastMultipliers);
			if (cfitMetric == null) {
				this.log.info(`Victim ${victim.pilotNames[0]} was too far away from ${killer.pilotNames[0]}, so CFIT being dropped`);
				victim.deaths++;
				ELOUpdater.updateUserLogForDeath(new Date().toISOString(), victim, 0);
				await this.app.users.update(victim, victim.id);
				return;
			}
			info = extraInfo;
			metric = cfitMetric;
		}

		const aircraftOffset = ELOUpdater.getKillAircraftOffset(kill);
		const eloSteal = ELOUpdater.calculateEloSteal(killer.elo, victim.elo, aircraftOffset, metric?.multiplier ?? 1);

		this.log.info(`Killer ${killer.pilotNames[0]} (${killer.elo}) killed victim ${victim.pilotNames[0]} (${victim.elo}) for ${eloSteal.toFixed(1)} ELO`);
		this.log.info(` -> ${killer.pilotNames[0]} ELO: ${killer.elo} -> ${killer.elo + eloSteal}`);
		this.log.info(` -> ${victim.pilotNames[0]} ELO: ${victim.elo} -> ${victim.elo - eloSteal}`);

		killer.eloHistory.push({ time: Date.now(), elo: killer.elo });
		victim.eloHistory.push({ time: Date.now(), elo: victim.elo });

		killer.elo += eloSteal;
		victim.elo -= eloSteal;
		victim.elo = Math.max(victim.elo, 1);
		ELOUpdater.updateUserLogForKill(new Date().toISOString(), killer, victim, metric, kill, eloSteal, killStr);

		killer.kills++;
		victim.deaths++;

		await this.app.users.update(killer, killer.id);
		await this.app.users.update(victim, victim.id);
		return { killer, victim, eloSteal };
	}

	private async updateELOForTeamKill(killer: User, victim: User) {
		const eloSteal = killer.elo * teamKillPenalty;
		this.log.info(`User ${killer.pilotNames[0]} lost ${eloSteal.toFixed(1)} ELO for team killing`);
		this.log.info(` -> ${killer.pilotNames[0]} ELO: ${killer.elo} -> ${killer.elo - eloSteal}`);

		killer.eloHistory.push({ time: Date.now(), elo: killer.elo });
		killer.elo -= eloSteal;
		killer.elo = Math.max(killer.elo, 1);
		ELOUpdater.updateUserLogForTK(new Date().toISOString(), killer, victim, eloSteal);

		await this.app.users.update(killer, killer.id);
		await this.app.users.collection.updateOne({ id: killer.id }, { $inc: { teamKills: 1 } });
		killer.teamKills++;
		const shouldBeBanned = shouldUserBeBanned(killer);
		if (shouldBeBanned) {
			this.log.info(`Banning user ${killer.pilotNames[0]} for team killing`);
			await this.app.users.collection.updateOne({ id: killer.id }, { $set: { isBanned: true } });
		}
		return eloSteal;
	}

	public async updateELOForDeath(death: Death) {
		const victim = await this.app.users.get(death.victim.ownerId);
		if (!victim) {
			this.log.error(`Victim ${death.victim.ownerId} not found!`);
			return;
		}

		const eloSteal = ELOUpdater.calculateEloSteal(BASE_ELO, victim.elo);
		this.log.info(`User ${victim.pilotNames[0]} died and lost ${eloSteal.toFixed(1)} ELO`);
		this.log.info(` -> ${victim.pilotNames[0]} ELO: ${victim.elo} -> ${victim.elo - eloSteal}`);

		victim.eloHistory.push({ time: Date.now(), elo: victim.elo });
		victim.elo -= eloSteal;
		victim.elo = Math.max(victim.elo, 1);
		victim.deaths++;
		ELOUpdater.updateUserLogForDeath(new Date().toISOString(), victim, eloSteal);

		await this.app.users.update(victim, victim.id);

		return { eloSteal };
	}

	public static getCFITMultiplier(kill: Kill, multipliers: KillMetric[]): { cfitMetric: KillMetric; extraInfo: string } {
		const dist = Math.sqrt(Math.pow(kill.killer.position.x - kill.victim.position.x, 2) + Math.pow(kill.killer.position.z - kill.victim.position.z, 2));
		const nm = 1852;
		let weaponEquivalent: Weapon = null;
		if (dist / nm < 1) weaponEquivalent = Weapon.Gun;
		else if (dist / nm < 5) weaponEquivalent = Weapon.AIM9;
		else if (dist / nm < 10) weaponEquivalent = Weapon.AIM7;
		else if (dist / nm < 20) weaponEquivalent = Weapon.AIM120;

		if (weaponEquivalent != null) {
			const metric = multipliers.find(km => km.killStr == `${Aircraft[Aircraft.FA26b]}->${Weapon[weaponEquivalent]}->${Aircraft[Aircraft.FA26b]}`);
			return { cfitMetric: metric, extraInfo: "Distance: " + (dist / nm).toFixed(1) + "nm" };
		} else {
			return { cfitMetric: null, extraInfo: null };
		}
	}

	public static getKillAircraftOffset(kill: Kill) {
		const killerMult = aircraftBonusMults[kill.killer.type];
		const victimMult = aircraftBonusMults[kill.victim.type];
		return killerMult.killMult * victimMult.deathMult;
	}

	public static calculateEloSteal(killerElo: number, victimElo: number, aircraftOffset = 1, multiplier = 1) {
		const eloDiff = Math.abs(victimElo - killerElo);
		const additionalStealConst = killerElo < victimElo ? stealPerEloGainedPoints : -stealPerEloLostPoints;
		const eloSteal = Math.min(
			maxEloStealPoints,
			Math.max(baseEloStealPoints + eloDiff * additionalStealConst, minEloStealPoints) * multiplier * aircraftOffset
		);
		return eloSteal;
	}
}

export { ELOUpdater, BASE_ELO, shouldKillBeCounted, shouldDeathBeCounted, userCanRank, getKillStr, KillString, KillMetric, hourlyReportPath };
