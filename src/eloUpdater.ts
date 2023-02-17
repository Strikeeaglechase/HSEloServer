// import glickoPkg from "glicko2-lite";
import e from "express";
import fs from "fs";
import path from "path";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import Database from "strike-discord-framework/dist/database.js";
import Logger from "strike-discord-framework/dist/logger.js";

import { Application } from "./application.js";
import { shouldUserBeBanned } from "./banHandler.js";
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
		const log = this.getUserLogText(userId);
		if (!fs.existsSync("../userLogs")) fs.mkdirSync("../userLogs");
		fs.writeFileSync(`../userLogs/${userId}.txt`, log);
		return path.resolve(`../userLogs/${userId}.txt`);
	}

	public getUserLogText(userId: string) {
		return this.userLogs[userId] ?? "No data";
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
		const firstStart = Date.now();
		const gen = this.internalBackUpdateElosWithMultipliers(usersDb, killsDb, deathsDb, doUpdate);
		let lastAwaitTime = Date.now();
		let numPause = 0;
		for await (const _ of gen) {
			if (Date.now() - lastAwaitTime > 250) {
				lastAwaitTime = Date.now();
				await new Promise(res => setTimeout(res, 100));
				numPause++;
			}
		}
		console.log(`Back update process completed, took ${Date.now() - firstStart}ms, paused for ${numPause * 100}ms`);
	}

	private checkInvalidUsers(users: User[]) {
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

	private async *internalBackUpdateElosWithMultipliers(
		usersDb: CollectionManager<string, User>,
		killsDb: CollectionManager<string, Kill>,
		deathsDb: CollectionManager<string, Death>,
		doUpdate = false
	) {
		// let d = Date.now();

		let users = await usersDb.get();
		let kills = await killsDb.get();
		let deaths = await deathsDb.get();
		// console.log(`User load took ${Date.now() - d}ms`);
		// d = Date.now();
		this.backupUsers(users);
		const invalid = this.checkInvalidUsers(users);
		invalid.forEach(invalidUid => {
			usersDb.collection.deleteOne({ _id: invalidUid });
			// @ts-ignore
			users = users.filter(u => u._id != invalidUid);
		});
		// console.log(`User backup took ${Date.now() - d}ms`);
		// d = Date.now();

		kills = kills.filter(k => isKillValid(k)).sort((a, b) => a.time - b.time);
		deaths = deaths.sort((a, b) => a.time - b.time);

		const killMultipliers = this.getEloMultipliers(kills);
		const eloGainedPerWeapon: Record<string, Record<string, number>> = {};
		users.forEach(u => {
			u.elo = BASE_ELO;
			u.kills = 0;
			u.deaths = 0;
			u.eloHistory = [];
			this.userLogs[u.id] = "";
			eloGainedPerWeapon[u.id] = {};
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
		// console.log(`Setup took ${Date.now() - d}ms`);
		// d = Date.now();

		for (let i = 0; i < events.length; i++) {
			const e = events[i];

			const timestamp = new Date(e.time).toISOString();
			if (e.type == "kill") {
				const kill = e.event as Kill;
				const killer = users.find(u => u.id == kill.killerId);
				const victim = users.find(u => u.id == kill.victimId);
				const killStr = getKillStr(kill);

				if (!killer || !victim) {
					continue;
				}
				if (kill.killerTeam == kill.victimTeam) {
					const loss = killer.elo * teamKillPenalty;
					killer.elo -= loss;
					this.updateUserLogForTK(timestamp, killer, victim, loss);
					killer.eloHistory.push({ elo: killer.elo, time: e.time });
					continue;
				}

				let metric = killMultipliers.find(m => m.killStr == killStr);
				let info = "";
				if (kill.weapon == Weapon.CFIT) {
					const { cfitMetric, extraInfo } = this.getCFITMultiplier(kill);
					if (cfitMetric == null) {
						// this.log.info(`Target was too far away, so CFIT being dropped`);
						victim.deaths++;
						this.updateUserLogForDeath(timestamp, victim, 0);
						continue;
					}
					info = extraInfo;
					metric = cfitMetric;
				}
				const eloSteal = this.calculateEloSteal(killer.elo, victim.elo, metric?.multiplier ?? 1);

				killer.elo += eloSteal;
				victim.elo -= eloSteal;
				victim.elo = Math.max(victim.elo, 1);
				killer.kills++;
				victim.deaths++;

				this.updateUserLogForKill(timestamp, killer, victim, metric, eloSteal, killStr, info /*+ ` (${kill.id}) `*/);
				killer.eloHistory.push({ elo: killer.elo, time: e.time });
				victim.eloHistory.push({ elo: victim.elo, time: e.time });

				if (!eloGainedPerWeapon[killer.id][Weapon[kill.weapon]]) eloGainedPerWeapon[killer.id][Weapon[kill.weapon]] = 0;
				eloGainedPerWeapon[killer.id][Weapon[kill.weapon]] += eloSteal;
			} else if (e.type == "death") {
				const death = e.event as Death;
				if (death.killId) continue;
				const victim = users.find(u => u.id == death.victimId);
				if (!victim) continue;

				const eloSteal = this.calculateEloSteal(BASE_ELO, victim.elo);
				victim.elo -= eloSteal;
				victim.elo = Math.max(victim.elo, 1);
				victim.deaths++;

				this.updateUserLogForDeath(timestamp, victim, eloSteal);
				victim.eloHistory.push({ elo: victim.elo, time: e.time });
			} else if (e.type == "action") {
				const action = e.event as Action;
				this.userLogs[action.userId] += `[${timestamp}] ${action.action}\n`;
			}

			// console.log(`Processed ${i + 1}/${events.length} events`);
			yield i;
		}

		// console.log(`Processing took ${Date.now() - d}ms`);
		// d = Date.now();

		if (doUpdate) {
			this.log.info(`Updating ${users.length} users...`);
			users.forEach(u => usersDb.update(u, u.id));
		} else {
			users = users.sort((a, b) => b.elo - a.elo);
			// let ru = 0;
			for (let i = 0; i < 40; i++) {
				if (users[i].kills > 10) {
					const totalGained = Object.values(eloGainedPerWeapon[users[i].id]).reduce((a, b) => a + b, 0);
					const gainedWpnStr = Object.entries(eloGainedPerWeapon[users[i].id]).map(([wpn, elo]) => `${wpn}: ${Math.round(elo / totalGained * 100)}%`).join(", ");
					console.log(`${users[i].pilotNames[0]} (${users[i].id}) - ${users[i].elo.toFixed(1)}  ${gainedWpnStr}`);
				}
			}
			const last = users[users.length - 1];
			console.log(`${last.pilotNames[0]} (${last.id}) - ${last.elo.toFixed(1)}`);
			// console.log(users.filter(u => u.elo < 1000).map(u => { return { id: u.id, pilotName: u.pilotNames }; }));
			fs.writeFileSync('../out-log.txt', this.userLogs["76561197997932245"]);
			// await createUserEloGraph(users.find(u => u.id == "76561198093124125"));
			// console.log(`Loss due to death: ${lossDueToDeath.toFixed(0)}`);
			// console.log(`Loss due to teamkill: ${lossDueToTk.toFixed(0)}`);
			// process.exit();
		}
	}

	private updateUserLogForKill(timestamp: string, killer: User, victim: User, metric: KillMetric, eloSteal: number, killStr: string, extraInfo: string = "") {
		if (!this.userLogs[killer.id]) this.userLogs[killer.id] = "";
		if (!this.userLogs[victim.id]) this.userLogs[victim.id] = "";
		this.userLogs[killer.id] += `[${timestamp}] Kill ${victim.pilotNames[0]} (${Math.round(victim.elo)}) with ${killStr} (${metric?.multiplier.toFixed(1)}) ${extraInfo} Elo gained: ${Math.round(eloSteal)}. New Elo: ${Math.round(killer.elo)} \n`;
		this.userLogs[victim.id] += `[${timestamp}] Death to ${killer.pilotNames[0]} (${Math.round(killer.elo)}) with ${killStr} (${metric?.multiplier.toFixed(1)}) ${extraInfo} Elo lost: ${Math.round(eloSteal)}. New Elo: ${Math.round(victim.elo)} \n`;
	}

	private updateUserLogForDeath(timestamp: string, victim: User, eloSteal: number) {
		if (!this.userLogs[victim.id]) this.userLogs[victim.id] = "";
		this.userLogs[victim.id] += `[${timestamp}] Death (unknown) Elo lost: ${Math.round(eloSteal)}. New Elo: ${Math.round(victim.elo)} \n`;
	}

	private updateUserLogForTK(timestamp: string, killer: User, victim: User, eloSteal: number) {
		if (!this.userLogs[killer.id]) this.userLogs[killer.id] = "";
		if (!this.userLogs[victim.id]) this.userLogs[victim.id] = "";
		this.userLogs[killer.id] += `[${timestamp}] Teamkill ${victim.pilotNames[0]} Elo lost: ${Math.round(eloSteal)}. New Elo: ${Math.round(killer.elo)} \n`;
		this.userLogs[victim.id] += `[${timestamp}] Death to teamkill from ${killer.pilotNames[0]} no elo lost \n`;
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
			const loss = await this.updateELOForTeamKill(killer, victim);
			return {
				killer: killer,
				victim: killer,
				eloSteal: loss,
				eloStealPrec: 0,
			};
		}

		const killStr = getKillStr(kill);
		let metric = this.lastMultipliers.find(m => m.killStr == killStr);
		let info = "";
		if (kill.weapon == Weapon.CFIT) {
			const { cfitMetric, extraInfo } = this.getCFITMultiplier(kill);
			if (cfitMetric == null) {
				this.log.info(`Victim ${victim.pilotNames[0]} was too far away from ${killer.pilotNames[0]}, so CFIT being dropped`);
				victim.deaths++;
				this.updateUserLogForDeath(new Date().toISOString(), victim, 0);
				await this.app.users.update(victim, victim.id);
				return;
			}
			info = extraInfo;
			metric = cfitMetric;
		}
		const eloSteal = this.calculateEloSteal(killer.elo, victim.elo, metric?.multiplier ?? 1);

		this.log.info(`Killer ${killer.pilotNames[0]} (${killer.elo}) killed victim ${victim.pilotNames[0]} (${victim.elo}) for ${eloSteal.toFixed(1)} ELO`);
		this.log.info(` -> ${killer.pilotNames[0]} ELO: ${killer.elo} -> ${killer.elo + eloSteal}`);
		this.log.info(` -> ${victim.pilotNames[0]} ELO: ${victim.elo} -> ${victim.elo - eloSteal}`);

		killer.eloHistory.push({ time: Date.now(), elo: killer.elo });
		victim.eloHistory.push({ time: Date.now(), elo: victim.elo });

		killer.elo += eloSteal;
		victim.elo -= eloSteal;
		victim.elo = Math.max(victim.elo, 1);
		this.updateUserLogForKill(new Date().toISOString(), killer, victim, metric, eloSteal, killStr);

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
		this.updateUserLogForTK(new Date().toISOString(), killer, victim, eloSteal);

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

		const eloSteal = this.calculateEloSteal(BASE_ELO, victim.elo);
		this.log.info(`User ${victim.pilotNames[0]} died and lost ${eloSteal.toFixed(1)} ELO`);
		this.log.info(` -> ${victim.pilotNames[0]} ELO: ${victim.elo} -> ${victim.elo - eloSteal}`);

		victim.eloHistory.push({ time: Date.now(), elo: victim.elo });
		victim.elo -= eloSteal;
		victim.elo = Math.max(victim.elo, 1);
		victim.deaths++;
		this.updateUserLogForDeath(new Date().toISOString(), victim, eloSteal);

		await this.app.users.update(victim, victim.id);
	}

	private getCFITMultiplier(kill: Kill): { cfitMetric: KillMetric, extraInfo: string; } {
		const dist = Math.sqrt(Math.pow(kill.killerPosition.x - kill.victimPosition.x, 2) + Math.pow(kill.killerPosition.z - kill.victimPosition.z, 2));
		const nm = 1852;

		let weaponEquivalent: Weapon = null;
		if (dist / nm < 1) weaponEquivalent = Weapon.Gun;
		else if (dist / nm < 5) weaponEquivalent = Weapon.AIM9;
		else if (dist / nm < 10) weaponEquivalent = Weapon.AIM7;
		else if (dist / nm < 20) weaponEquivalent = Weapon.AIM120;

		if (weaponEquivalent != null) {
			const metric = this.lastMultipliers.find(km => km.killStr == `${Aircraft[Aircraft.FA26b]}->${Weapon[weaponEquivalent]}->${Aircraft[Aircraft.FA26b]}`);
			return { cfitMetric: metric, extraInfo: "Distance: " + (dist / nm).toFixed(1) + "nm" };
		} else {
			return { cfitMetric: null, extraInfo: null };
		}


	}

	private calculateEloSteal(killerElo: number, victimElo: number, multiplier = 1) {
		let stealBase: number;
		const diff = victimElo - killerElo;
		calculate:{
            if (diff<-1500) {stealBase = 2.5 * Math.exp((diff+1500)/500); break calculate;}
            if (diff<0) {stealBase = baseEloStealPoints + diff * stealPerEloLostPoints; break calculate;}
            if (diff<1500) {stealBase = baseEloStealPoints + diff * stealPerEloGainedPoints; break calculate;}
            else stealBase = 30 - 5 * Math.exp((1500-diff)/500);
        }

		const eloSteal = Math.min(maxEloStealPoints, stealBase * multiplier);
		return eloSteal;
	}
}

export { ELOUpdater, BASE_ELO };