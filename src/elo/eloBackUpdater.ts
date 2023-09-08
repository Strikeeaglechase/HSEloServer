import { config } from "dotenv";
import fs from "fs";

import { CollectionManager } from "../db/collectionManager.js";
import Database from "../db/database.js";
import { Aircraft, Death, isKillValid, Kill, Season, User, Weapon } from "../structures.js";
import {
	BASE_ELO, ELOUpdater, getKillStr, KillMetric, KillString, maxWeaponMultiplier,
	shouldDeathBeCounted, shouldKillBeCounted, t55Penalty, teamKillPenalty, userCanRank
} from "./eloUpdater.js";

config();
const userBackupPath = "../users/";
const userChunkSize = 100; // Send 100 users at a time



function shouldKillContributeToMultipliers(kill: Kill) {
	if (kill.weapon == Weapon.CFIT) return false;
	if (kill.killer.type == Aircraft.T55) return false;
	if (kill.victim.type == Aircraft.T55) return false;
	return shouldKillBeCounted(kill);
}

interface UserResult {
	user: User;
	log: string;
}
type IPCMessage = { users: UserResult[]; type: "users"; } | { type: "mults", mults: KillMetric[]; };

// type UserLogsObj = Record<string, string>;
type Action = { action: "Login" | "Logout"; userId: string; };
interface EloKillEvent {
	event: Kill;
	time: number;
	type: "kill";
}

interface EloDeathEvent {
	event: Death;
	time: number;
	type: "death";
}

interface EloActionEvent {
	event: Action;
	time: number;
	type: "action";
}

type EloEvent = EloKillEvent | EloDeathEvent | EloActionEvent;

class EloBackUpdater {
	protected db: Database;
	protected userDb: CollectionManager<User>;
	protected seasons: CollectionManager<Season>;
	// protected userLogs: UserLogsObj = {};

	protected kills: Kill[] = [];
	protected killsMap: Record<string, Kill> = {};
	protected deaths: Death[] = [];

	protected killMultipliers: KillMetric[] = [];

	protected users: User[] = [];
	protected usersMap: Record<string, User> = {};

	protected season: Season;

	protected events: EloEvent[] = [];

	protected async loadDb() {
		this.db = new Database({
			databaseName: "vtol-server-elo" + (process.env.IS_DEV == "true" ? "-dev" : ""),
			url: process.env.DB_URL
		}, console.log);

		await this.db.init();
		this.userDb = await this.db.collection("users", false, "id");
		this.seasons = await this.db.collection("seasons", false, "id");
	}

	protected loadFileStreamed<T>(path: string): Promise<T[]> {
		const readStream = fs.createReadStream(path);
		return new Promise((res) => {
			let remaining = "";
			const result: T[] = [];

			readStream.on("data", data => {
				const parts = (remaining + data).split("\n");
				remaining = parts.pop();

				parts.forEach(part => result.push(JSON.parse(part)));
			});

			readStream.on("end", () => {
				if (remaining.length > 0) result.push(JSON.parse(remaining));
				res(result);
			});
		});
	}

	protected async loadFromHourlyReport() {
		console.log(`Loading from hourly report...`);
		this.kills = await this.loadFileStreamed<Kill>("../hourlyReport/kills.json");
		this.deaths = await this.loadFileStreamed<Death>("../hourlyReport/deaths.json");

		console.log(`Loaded ${this.kills.length} kills and ${this.deaths.length} deaths.`);
	}

	protected calculateEloMultipliers() {
		const killCounts: Record<KillString, number> = {};
		let totalCountedKills = 0;
		this.kills.forEach(kill => {
			if (!shouldKillContributeToMultipliers(kill)) return;
			const str = getKillStr(kill);
			killCounts[str] = (killCounts[str] || 0) + 1;
			totalCountedKills++;
		});

		const killMetrics: KillMetric[] = [];

		for (const [killStr, count] of Object.entries(killCounts)) {
			killMetrics.push({ killStr: killStr as KillString, count, prec: count / totalCountedKills, multiplier: 1 });
		}

		const relevantMetrics = killMetrics.sort((a, b) => b.count - a.count);

		const expectPrec = 1 / relevantMetrics.length;
		const normalizerMetricPrec = relevantMetrics.find(m => m.killStr == "FA26b->AIM120->FA26b")?.prec ?? expectPrec;

		const normalizer = 1 / (expectPrec / normalizerMetricPrec);
		relevantMetrics.forEach(metric => {
			const multiplier = expectPrec / metric.prec * normalizer;
			metric.multiplier = Math.min(multiplier, maxWeaponMultiplier);
		});

		this.killMultipliers = relevantMetrics;

		console.log(`Calculated ${this.killMultipliers.length} kill multipliers`);
	}

	protected backupUsers(users: User[]) {
		if (!fs.existsSync(userBackupPath)) fs.mkdirSync(userBackupPath);
		const ts = new Date().toISOString().replace(/:/g, "-");
		fs.writeFileSync(`${userBackupPath}${ts}.json`, JSON.stringify(users));
	}

	protected async loadUsers() {
		const usersMap: Record<string, User> = {};
		const users = await this.userDb.collection.find({}).toArray();
		this.backupUsers(users);

		users.forEach(u => {
			u.elo = BASE_ELO;
			u.kills = 0;
			u.deaths = 0;
			u.eloHistory = [];
			u.history = [];

			usersMap[u.id] = u;
		});

		this.users = users;
		this.usersMap = usersMap;

		console.log(`Loaded ${users.length} users.`);
	}

	protected async loadKillsAndDeaths() {
		await this.loadFromHourlyReport();
		this.kills = this.kills.filter(kill => kill.season == this.season.id && isKillValid(kill)).sort((a, b) => a.time - b.time);
		this.deaths = this.deaths.filter(kill => kill.season == this.season.id).sort((a, b) => a.time - b.time);

		this.kills.forEach(kill => this.killsMap[kill.id] = kill);

		console.log(`After filtering for season ${this.season.id}, there are ${this.kills.length} kills and ${this.deaths.length} deaths.`);
	}

	protected loadEvents() {
		this.kills.forEach(kill => this.events.push({ event: kill, time: kill.time, type: "kill" }));
		this.deaths.forEach(death => this.events.push({ event: death, time: death.time, type: "death" }));

		const seasonStartTime = new Date(this.season.started).getTime();
		const seasonEndTime = new Date(this.season.ended).getTime();
		this.users.forEach(user => {
			const validLoginTimes = user.loginTimes.filter(t =>
				(seasonStartTime == 0 || t >= seasonStartTime) &&
				(seasonEndTime == 0 || t <= seasonEndTime)
			);

			const validLogoutTimes = user.logoutTimes.filter(t =>
				(seasonStartTime == 0 || t >= seasonStartTime) &&
				(seasonEndTime == 0 || t <= seasonEndTime)
			);

			validLoginTimes.forEach(login => this.events.push({ event: { action: "Login", userId: user.id }, time: login, type: "action" }));
			validLogoutTimes.forEach(logout => this.events.push({ event: { action: "Logout", userId: user.id }, time: logout, type: "action" }));
		});

		this.events = this.events.sort((a, b) => a.time - b.time);

		console.log(`Loaded ${this.events.length} events.`);
	}

	public async runBackUpdate() {
		await this.loadDb();
		const start = Date.now();
		this.season = await this.seasons.collection.findOne({ active: true });
		console.log(`Active season: ${this.season.id} (${this.season.name})`);

		await this.loadUsers();
		await this.loadKillsAndDeaths();
		this.calculateEloMultipliers();
		this.loadEvents();


		for (let i = 0; i < this.events.length; i++) {
			const e = this.events[i];

			const timestamp = new Date(e.time).toISOString();
			if (e.type == "kill") {
				const kill = e.event as Kill;
				const killer = this.usersMap[kill.killer.ownerId];
				const victim = this.usersMap[kill.victim.ownerId];
				const killStr = getKillStr(kill);

				if (!killer || !victim || !shouldKillBeCounted(kill, killer, victim)) {
					continue;
				}

				if (kill.killer.team == kill.victim.team) {
					const loss = killer.elo * teamKillPenalty;
					killer.elo -= loss;
					ELOUpdater.updateUserLogForTK(timestamp, killer, victim, loss);
					killer.eloHistory.push({ elo: killer.elo, time: e.time });
					continue;
				}

				if (kill.killer.type == Aircraft.T55) {
					if (victim.elo < t55Penalty) continue;
					const loss = t55Penalty;
					victim.elo -= loss;
					ELOUpdater.updateUserLogForT55(timestamp, killer, victim, loss);
					victim.eloHistory.push({ elo: victim.elo, time: e.time });
					continue;
				}

				if (killer.ignoreKillsAgainstUsers && killer.ignoreKillsAgainstUsers.includes(victim.id)) continue;

				let metric = this.killMultipliers.find(m => m.killStr == killStr);
				let info = "";
				if (kill.weapon == Weapon.CFIT) {
					const { cfitMetric, extraInfo } = ELOUpdater.getCFITMultiplier(kill, this.killMultipliers);
					if (cfitMetric == null) {
						// this.log.info(`Target was too far away, so CFIT being dropped`);
						victim.deaths++;
						ELOUpdater.updateUserLogForDeath(timestamp, victim, 0);
						continue;
					}
					info = extraInfo;
					metric = cfitMetric;
				}
				const eloSteal = ELOUpdater.calculateEloSteal(killer.elo, victim.elo, metric?.multiplier ?? 1);

				killer.elo += eloSteal;
				victim.elo -= eloSteal;
				victim.elo = Math.max(victim.elo, 1);
				killer.kills++;
				victim.deaths++;

				ELOUpdater.updateUserLogForKill(timestamp, killer, victim, metric, eloSteal, killStr, info);
				killer.eloHistory.push({ elo: killer.elo, time: e.time });
				victim.eloHistory.push({ elo: victim.elo, time: e.time });
				this.onUserUpdate(killer, e, eloSteal);
				this.onUserUpdate(victim, e, eloSteal);
			} else if (e.type == "death") {
				const death = e.event as Death;
				if (death.killId) continue;
				const victim = this.usersMap[death.victim.ownerId];
				if (!victim) continue;
				const kill = death.killId ? this.killsMap[death.killId] : null;
				if (!shouldDeathBeCounted(death, kill)) continue;


				const eloSteal = ELOUpdater.calculateEloSteal(BASE_ELO, victim.elo);
				victim.elo -= eloSteal;
				victim.elo = Math.max(victim.elo, 1);
				victim.deaths++;

				ELOUpdater.updateUserLogForDeath(timestamp, victim, eloSteal);
				victim.eloHistory.push({ elo: victim.elo, time: e.time });
				this.onUserUpdate(victim, e, eloSteal);
			} else if (e.type == "action") {
				const action = e.event as Action;
				const user = this.usersMap[action.userId];
				if (!user) continue;
				user.history.push(`[${timestamp}] ${action.action}`);
				this.onUserUpdate(user, e, 0);
			}
		}

		console.log(`Primary back update calculations done! Took ${Date.now() - start}ms`);
	}

	protected onUserUpdate(user: User, event: EloEvent, eloDelta: number) { }

	public async storeResults() {
		const rankedUsers = this.users.filter(u => userCanRank(u)).sort((a, b) => b.elo - a.elo);
		this.seasons.collection.updateOne({ id: this.season.id }, { $set: { totalRankedUsers: rankedUsers.length } });

		rankedUsers.forEach((user, i) => user.rank = i + 1);
		this.users.filter(u => !userCanRank(u)).forEach(user => user.rank = null); // Un-rank users

		// Update all the users
		const proms = this.users.map(user => {
			this.userDb.update(user, user.id);
		});

		await Promise.all(proms);
	}

	public async sendResult() {
		if (!process.send) {
			console.log("No process.send, so not sending result");
			return;
		}

		// console.log(`Sending ${this.users.length} users`);
		// for (let i = 0; i < this.users.length; i += userChunkSize) {
		// 	const chunk = this.users.slice(i, i + userChunkSize);
		// 	const data: UserResult[] = chunk.map(u => ({ user: u, log: this.userLogs[u.id] }));
		// 	const message: IPCMessage = { type: "users", users: data };
		// 	process.send(message);
		// }

		// console.log(`Done sending users`);

		const message: IPCMessage = { type: "mults", mults: this.killMultipliers };
		process.send(message);
	}
}

process.on("message", async (msg) => {
	if (msg != "start") {
		console.log(`Unknown message: ${msg}`);
		return;
	}

	const updater = new EloBackUpdater();
	await updater.runBackUpdate();
	await updater.sendResult();
	await updater.storeResults();
});


export { IPCMessage, EloBackUpdater, EloEvent };