// import glickoPkg from "glicko2-lite";
import e from "express";
import fs from "fs";
import path from "path";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import Database from "strike-discord-framework/dist/database.js";
import Logger from "strike-discord-framework/dist/logger.js";

import { Application } from "./application.js";
import { shouldUserBeBanned } from "./banHandler.js";
import { createUserEloGraph } from "./graph/graph.js";
import { Aircraft, Death, isKillValid, Kill, User, Weapon } from "./structures.js";

const BASE_ELO = 2000;

// Normal kill takes 10 points
const baseEloStealPoints = 10;
// Always take at least 0.1 points
const minEloStealPoints = 0.1;
// Take at most 150 points
const maxEloStealPoints = 150;
// For every 100 points apart, take 1 point more, assuming the victim has more ELO than the killer
const stealPerEloGainedPoints = 1 / 100;
// For every 100 points apart, take 0.5 points less, assuming the victim has less ELO than the killer
const stealPerEloLostPoints = 0.5 / 100;
// Loose 0% of ELO for a team kill
const teamKillPenalty = 0.00;

// Maximum multiplier for an aircraft/weapon combo (limited by maxEloStealPrec)
const maxWeaponMultiplier = Infinity;

const userBackupPath = "../users/";

type KillString = `${string}->${string}->${string}`;
interface KillMetric {
	killStr: KillString;
	count: number;
	prec: number;
	multiplier: number;
}

function getKillStr(kill: Kill) {
	return `${Aircraft[kill.killerAircraft]}->${Weapon[kill.weapon]}->${Aircraft[kill.victimAircraft]}`;
}
class ELOUpdater {
	private log: Logger;
	private prodDb: Database;
	private prodUsers: CollectionManager<string, User>;
	private prodKills: CollectionManager<string, Kill>;
	private prodDeaths: CollectionManager<string, Death>;

	public lastMultipliers: KillMetric[] = [];
	private userLogs: Record<string, string> = {};

	constructor(private app: Application) {
		this.log = app.log;
	}

	public getUserLog(userId: string) {
		const log = this.userLogs[userId] ?? "No data";
		if (!fs.existsSync("../userLogs")) fs.mkdirSync("../userLogs");
		fs.writeFileSync(`../userLogs/${userId}.txt`, log);
		return path.resolve(`../userLogs/${userId}.txt`);
	}

	public async init() {
		this.prodDb = new Database({ databaseName: "vtol-server-elo", url: process.env.PROD_DB_URL }, this.log);
		await this.prodDb.init();

		this.prodUsers = await this.prodDb.collection("users", false, "id");
		this.prodKills = await this.prodDb.collection("kills", false, "id");
		this.prodDeaths = await this.prodDb.collection("deaths", false, "id");
		// this.checkSpawns();
		// this.backUpdateElosWithMultipliers(this.prodUsers, this.prodKills, this.prodDeaths, false);
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

	private backupUsers(users: User[]) {
		if (!fs.existsSync(userBackupPath)) fs.mkdirSync(userBackupPath);
		const ts = new Date().toISOString().replace(/:/g, "-");
		fs.writeFileSync(`${userBackupPath}${ts}.json`, JSON.stringify(users));
	}

	private getEloMultipliers(kills: Kill[]) {
		if (kills.length == 0) return;
		const killCounts: Record<KillString, number> = {};

		kills.forEach(kill => {
			const str = getKillStr(kill);
			killCounts[str] = (killCounts[str] || 0) + 1;
		});

		const killMetrics: KillMetric[] = [];

		for (const [killStr, count] of Object.entries(killCounts)) {
			// console.log(`${killStr} - ${count} (${(count / kills.length * 100).toFixed(1)}%)`);
			killMetrics.push({ killStr: killStr as KillString, count, prec: count / kills.length, multiplier: 1 });
		}

		const relevantMetrics = killMetrics.sort((a, b) => b.count - a.count);//.filter(metric => metric.prec > 0.01);
		if (relevantMetrics.find(m => m.killStr == "FA26b->AIM120->FA26b") == undefined) return [];
		const expectPerc = 1 / relevantMetrics.length;
		let normalizer = 1 / (expectPerc / relevantMetrics.find(m => m.killStr == "FA26b->AIM120->FA26b").prec);
		relevantMetrics.forEach(metric => {
			const multiplier = expectPerc / metric.prec * normalizer;
			// console.log(`${metric.killStr} - ${metric.count} (${(metric.prec * 100).toFixed(1)}%) - ${(multiplier).toFixed(1)}x`);
			metric.multiplier = Math.min(multiplier, maxWeaponMultiplier);
		});

		this.lastMultipliers = relevantMetrics;
		return relevantMetrics;
	}

	public async backUpdateElosWithMultipliers(
		usersDb: CollectionManager<string, User>,
		killsDb: CollectionManager<string, Kill>,
		deathsDb: CollectionManager<string, Death>,
		doUpdate = false
	) {
		let lossDueToTk = 0;
		let lossDueToDeath = 0;
		let users = await usersDb.get();
		let kills = await killsDb.get();
		let deaths = await deathsDb.get();
		this.backupUsers(users);

		// users.forEach(user => { });

		kills = kills.filter(k => isKillValid(k)).sort((a, b) => a.time - b.time);
		deaths = deaths.sort((a, b) => a.time - b.time);

		const killMultipliers = this.getEloMultipliers(kills);
		// console.log(killMultipliers);
		users.forEach(u => {
			u.elo = BASE_ELO;
			u.kills = 0;
			u.deaths = 0;
			u.eloHistory = [];
			this.userLogs[u.id] = "";
		});
		type Action = { action: "Login" | "Logout"; userId: string; };
		let events: { event: Kill | Death | Action, time: number, type: "kill" | "death" | "action"; }[] = [];
		kills.forEach(kill => events.push({ event: kill, time: kill.time, type: "kill" }));
		deaths.forEach(death => events.push({ event: death, time: death.time, type: "death" }));
		users.forEach(user => {
			user.loginTimes.forEach(login => events.push({ event: { action: "Login", userId: user.id }, time: login, type: "action" }));
			user.logoutTimes.forEach(logout => events.push({ event: { action: "Logout", userId: user.id }, time: logout, type: "action" }));
		});
		events = events.sort((a, b) => a.time - b.time);
		events.forEach(e => {
			const timestamp = new Date(e.time).toISOString();
			if (e.type == "kill") {
				const kill = e.event as Kill;
				const killer = users.find(u => u.id == kill.killerId);
				const victim = users.find(u => u.id == kill.victimId);
				const killStr = getKillStr(kill);

				if (!killer || !victim) {
					return;
				}
				if (kill.killerTeam == kill.victimTeam) {
					const loss = killer.elo * teamKillPenalty;
					killer.elo -= loss;
					lossDueToTk += loss;
					this.userLogs[killer.id] += `[${timestamp}] Teamkill ${victim.pilotNames[0]} Elo lost: ${Math.round(loss)}. New Elo: ${Math.round(killer.elo)} \n`;
					killer.eloHistory.push({ elo: killer.elo, time: e.time });
					return;
				}

				const metric = killMultipliers.find(m => m.killStr == killStr);

				const eloChange = this.calculateEloSteal(killer.elo, victim.elo, metric?.multiplier ?? 1);
				killer.elo += eloChange.eloSteal;
				victim.elo -= eloChange.eloSteal;
				// const killerElo = killer.elo;
				// const victimElo = victim.elo;
				// killer.elo = this.calculateNewEloForWin(killerElo, victimElo, metric.multiplier ?? 1);
				// victim.elo = this.calculateNewEloForLoss(victimElo, killerElo, metric.multiplier ?? 1);
				victim.elo = Math.max(victim.elo, 1);
				killer.kills++;
				victim.deaths++;

				// console.log(`Killer elo delta: ${killer.elo - killerElo}. Victim elo delta: ${victim.elo - victimElo}`);
				this.userLogs[killer.id] += `[${timestamp}] Kill ${victim.pilotNames[0]} (${Math.round(victim.elo)}) with ${metric.killStr} (${metric.multiplier.toFixed(1)}) Elo gained: ${Math.round(eloChange.eloSteal)}. New Elo: ${Math.round(killer.elo)} \n`;
				this.userLogs[victim.id] += `[${timestamp}] Death to ${killer.pilotNames[0]} (${Math.round(killer.elo)}) with ${metric.killStr} (${metric.multiplier.toFixed(1)}) Elo lost: ${Math.round(eloChange.eloSteal)}. New Elo: ${Math.round(victim.elo)} \n`;
				killer.eloHistory.push({ elo: killer.elo, time: e.time });
				victim.eloHistory.push({ elo: victim.elo, time: e.time });

			} else if (e.type == "death") {
				const death = e.event as Death;
				if (death.killId) return;
				const victim = users.find(u => u.id == death.victimId);
				if (!victim) return;

				const eloChange = this.calculateEloSteal(BASE_ELO, victim.elo);
				victim.elo -= eloChange.eloSteal;
				// victim.elo = this.calculateNewEloForLoss(victim.elo, BASE_ELO);
				victim.elo = Math.max(victim.elo, 1);
				victim.deaths++;
				// lossDueToDeath += eloChange.eloSteal;

				this.userLogs[victim.id] += `[${timestamp}] Death (unknown) Elo lost: ${Math.round(eloChange.eloSteal)}. New Elo: ${Math.round(victim.elo)} \n`;
				victim.eloHistory.push({ elo: victim.elo, time: e.time });
			} else if (e.type == "action") {
				const action = e.event as Action;
				this.userLogs[action.userId] += `[${timestamp}] ${action.action}\n`;
			}
		});

		if (doUpdate) {
			this.log.info(`Updating ${users.length} users...`);
			users.forEach(u => usersDb.update(u, u.id));
		} else {
			users = users.sort((a, b) => b.elo - a.elo);
			// let ru = 0;
			for (let i = 0; i < 40; i++) {
				if (users[i].kills > 10) console.log(`${users[i].pilotNames[0]} (${users[i].id}) - ${users[i].elo.toFixed(1)}`);
			}
			const last = users[users.length - 1];
			console.log(`${last.pilotNames[0]} (${last.id}) - ${last.elo.toFixed(1)}`);
			// console.log(users.filter(u => u.elo < 1000).map(u => { return { id: u.id, pilotName: u.pilotNames }; }));
			fs.writeFileSync('../out-log.txt', this.userLogs["76561198017778651"]);
			await createUserEloGraph(users.find(u => u.id == "76561198017778651"));
			// console.log(`Loss due to death: ${lossDueToDeath.toFixed(0)}`);
			// console.log(`Loss due to teamkill: ${lossDueToTk.toFixed(0)}`);
			process.exit();
		}
	}

	public async updateELOForKill(kill: Kill) {
		const killer = await this.app.users.get(kill.killerId);
		const victim = await this.app.users.get(kill.victimId);

		if (!killer) {
			this.log.error(`Killer ${kill.killerId} not found!`);
			return;
		}

		if (!victim) {
			this.log.error(`Victim ${kill.victimId} not found!`);
			return;
		}

		if (kill.killerTeam == kill.victimTeam) {
			this.log.info(`User ${killer.pilotNames[0]} killed a teammate! Applying ELO penalty.`);
			const loss = await this.updateELOForTeamKill(killer);
			return {
				killer: killer,
				victim: killer,
				eloSteal: loss,
				eloStealPrec: 0,
			};
		}

		const killStr = getKillStr(kill);
		const metric = this.lastMultipliers.find(m => m.killStr == killStr);
		const { eloSteal } = this.calculateEloSteal(killer.elo, victim.elo, metric.multiplier ?? 1);

		this.log.info(`Killer ${killer.pilotNames[0]} (${killer.elo}) killed victim ${victim.pilotNames[0]} (${victim.elo}) for ${eloSteal.toFixed(1)} ELO`);
		this.log.info(` -> ${killer.pilotNames[0]} ELO: ${killer.elo} -> ${killer.elo + eloSteal}`);
		this.log.info(` -> ${victim.pilotNames[0]} ELO: ${victim.elo} -> ${victim.elo - eloSteal}`);

		killer.eloHistory.push({ time: Date.now(), elo: killer.elo });
		victim.eloHistory.push({ time: Date.now(), elo: victim.elo });

		killer.elo += eloSteal;
		victim.elo -= eloSteal;
		victim.elo = Math.max(victim.elo, 1);

		killer.kills++;
		victim.deaths++;

		await this.app.users.update(killer, killer.id);
		await this.app.users.update(victim, victim.id);
		return { killer, victim, eloSteal };
	}

	private async updateELOForTeamKill(killer: User) {
		const eloSteal = killer.elo * teamKillPenalty;
		this.log.info(`User ${killer.pilotNames[0]} lost ${eloSteal.toFixed(1)} ELO for team killing`);
		this.log.info(` -> ${killer.pilotNames[0]} ELO: ${killer.elo} -> ${killer.elo - eloSteal}`);

		killer.eloHistory.push({ time: Date.now(), elo: killer.elo });
		killer.elo -= eloSteal;
		killer.elo = Math.max(killer.elo, 1);

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
		const victim = await this.app.users.get(death.victimId);
		if (!victim) {
			this.log.error(`Victim ${death.victimId} not found!`);
			return;
		}

		const { eloSteal } = this.calculateEloSteal(BASE_ELO, victim.elo);
		this.log.info(`User ${victim.pilotNames[0]} died and lost ${eloSteal.toFixed(1)} ELO`);
		this.log.info(` -> ${victim.pilotNames[0]} ELO: ${victim.elo} -> ${victim.elo - eloSteal}`);

		victim.eloHistory.push({ time: Date.now(), elo: victim.elo });
		victim.elo -= eloSteal;
		victim.elo = Math.max(victim.elo, 1);
		victim.deaths++;

		await this.app.users.update(victim, victim.id);
	}

	private calculateEloSteal(killerElo: number, victimElo: number, multiplier = 1) {
		const eloDiff = Math.abs(victimElo - killerElo);
		const additionalStealConst = killerElo < victimElo ? stealPerEloGainedPoints : -stealPerEloLostPoints;
		const eloSteal = Math.min(maxEloStealPoints, Math.max((baseEloStealPoints + (eloDiff * additionalStealConst)), minEloStealPoints) * multiplier);
		return { eloSteal: eloSteal };
	}
}

export { ELOUpdater, BASE_ELO };