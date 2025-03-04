import { config } from "dotenv";
import fs from "fs";

import { CollectionManager } from "../db/collectionManager.js";
import Database from "../db/database.js";
import { createUserEloGraph } from "../graph/graph.js";
import { Death, isKillValid, Kill, Season, User, Weapon } from "../structures.js";
import {
	BASE_ELO,
	ELOUpdater,
	getKillStr,
	KillMetric,
	KillString,
	maxWeaponMultiplier,
	shouldDeathBeCounted,
	shouldKillBeCounted,
	teamKillPenalty,
	userCanRank
} from "./eloUpdater.js";

config();
const userBackupPath = "../users/";
const fullyOffline = false;
const manualSeasonSelection = 2;
const preFilterForInvalidKills = false;

function shouldKillContributeToMultipliers(kill: Kill) {
	if (kill.weapon == Weapon.CFIT || kill.weapon == Weapon.DCCFIT) return false;
	if (kill.weapon == Weapon.Collision) return false;
	return shouldKillBeCounted(kill);
}

interface UserResult {
	user: User;
	log: string;
}
type IPCMessage = { users: UserResult[]; type: "users" } | { type: "mults"; mults: KillMetric[] };

// type UserLogsObj = Record<string, string>;
type Action = { action: "Login" | "Logout"; userId: string };
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
	protected reportPath: string = "../hourlyReport";
	protected db: Database;
	protected userDb: CollectionManager<User>;
	protected seasons: CollectionManager<Season>;
	// protected userLogs: UserLogsObj = {};

	protected kills: Kill[] = [];
	protected killsMap: Record<string, Kill> = {};
	protected deaths: Death[] = [];

	protected killMultipliers: KillMetric[] = [];

	protected users: User[] = [];
	protected oldUsers: Record<string, User> = {};
	protected usersMap: Record<string, User> = {};
	protected userHistory: Record<string, string[]> = {};

	protected season: Season;

	protected events: EloEvent[] = [];

	public async loadDb() {
		if (fullyOffline) return;

		this.db = new Database(
			{
				databaseName: "vtol-server-elo" + (process.env.IS_DEV == "true" ? "-dev" : ""),
				url: process.env.DB_URL
			},
			console.log
		);

		await this.db.init();
		this.userDb = await this.db.collection("users", false, "id");
		this.seasons = await this.db.collection("seasons", false, "id");
	}

	protected loadFileStreamed<T>(path: string): Promise<T[]> {
		const readStream = fs.createReadStream(path);
		return new Promise(res => {
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

	protected streamFile<T>(path: string, cb: (data: T) => void): Promise<void> {
		const readStream = fs.createReadStream(path);
		return new Promise(res => {
			let remaining = "";
			const result: T[] = [];

			readStream.on("data", data => {
				const parts = (remaining + data).split("\n");
				remaining = parts.pop();

				parts.forEach(part => cb(JSON.parse(part)));
			});

			readStream.on("end", () => {
				if (remaining.length > 0) cb(JSON.parse(remaining));
				res();
			});
		});
	}

	protected async loadFromHourlyReport() {
		console.log(`Loading from hourly report...`);
		this.kills = await this.loadFileStreamed<Kill>(`${this.reportPath}/kills.json`);
		this.kills.forEach(kill => delete kill.serverInfo);
		this.deaths = await this.loadFileStreamed<Death>(`${this.reportPath}/deaths.json`);
		this.deaths.forEach(death => delete death.serverInfo);

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
		const normalizerMetricPrec = relevantMetrics.find(m => m.killStr == "FourthGen->HighTechRadar->FourthGen")?.prec ?? expectPrec;

		const normalizer = 1 / (expectPrec / normalizerMetricPrec);
		relevantMetrics.forEach(metric => {
			const multiplier = (expectPrec / metric.prec) * normalizer;
			metric.multiplier = Math.min(multiplier, maxWeaponMultiplier);
		});

		this.killMultipliers = relevantMetrics;

		console.log(`Calculated ${this.killMultipliers.length} kill multipliers`);
	}

	protected async calculateEloMultipliersStreamed() {
		const killCounts: Record<KillString, number> = {};
		let totalCountedKills = 0;

		await this.streamFile<Kill>(`${this.reportPath}/kills.json`, kill => {
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
		const normalizerMetricPrec = relevantMetrics.find(m => m.killStr == "FourthGen->HighTechRadar->FourthGen")?.prec ?? expectPrec;

		const normalizer = 1 / (expectPrec / normalizerMetricPrec);
		relevantMetrics.forEach(metric => {
			const multiplier = (expectPrec / metric.prec) * normalizer;
			metric.multiplier = Math.min(multiplier, maxWeaponMultiplier);
		});

		this.killMultipliers = relevantMetrics;

		console.log(`Calculated ${this.killMultipliers.length} kill multipliers`);
	}

	// protected backupUsers(users: User[]) {
	// 	if (!fs.existsSync(userBackupPath)) fs.mkdirSync(userBackupPath);
	// 	const ts = new Date().toISOString().replace(/:/g, "-");
	// 	fs.writeFileSync(`${userBackupPath}${ts}.json`, JSON.stringify(users));
	// }

	protected async loadUsers() {
		const usersMap: Record<string, User> = {};
		let users: User[] = [];

		if (!fullyOffline) {
			users = await this.userDb.collection
				.find(
					{ $or: [{ deaths: { $gt: 0 } }, { elo: { $ne: 2000 } }] },
					{ projection: { eloHistory: 0, history: 0, endOfSeasonStats: 0, loginTimes: 0, logoutTimes: 0 } }
				)
				.toArray();
		} else {
			users = await this.loadFileStreamed<User>(`${this.reportPath}/users.json`);
		}

		users.forEach(u => {
			this.oldUsers[u.id] = JSON.parse(JSON.stringify(u));
			u.elo = BASE_ELO;
			u.maxElo = BASE_ELO;
			u.kills = 0;
			u.deaths = 0;
			u.eloHistory = [];
			u.history = [];

			usersMap[u.id] = u;
			this.userHistory[u.id] = [];
		});

		this.users = users;
		this.usersMap = usersMap;

		console.log(`Loaded ${users.length} users.`);
	}

	protected async loadKillsAndDeaths() {
		await this.loadFromHourlyReport();
		this.kills = this.kills.filter(kill => kill.season == this.season.id && (isKillValid(kill) || !preFilterForInvalidKills)).sort((a, b) => a.time - b.time);
		this.deaths = this.deaths.filter(kill => kill.season == this.season.id).sort((a, b) => a.time - b.time);

		this.kills.forEach(kill => (this.killsMap[kill.id] = kill));

		console.log(`After filtering for season ${this.season.id}, there are ${this.kills.length} kills and ${this.deaths.length} deaths.`);
	}

	protected loadEvents() {
		this.kills.forEach(kill => this.events.push({ event: kill, time: kill.time, type: "kill" }));
		this.deaths.forEach(death => this.events.push({ event: death, time: death.time, type: "death" }));

		const seasonStartTime = new Date(this.season.started).getTime();
		const seasonEndTime = new Date(this.season.ended).getTime();
		this.users.forEach(user => {
			const validSessions = (user.sessions ?? []).filter(s => {
				const validTime = s.startTime || s.endTime;
				return (seasonStartTime == 0 || validTime >= seasonStartTime) && (seasonEndTime == 0 || validTime <= seasonEndTime);
			});

			validSessions.forEach(session => {
				if (session.startTime) this.events.push({ event: { action: "Login", userId: user.id }, time: session.startTime, type: "action" });
				if (session.endTime) this.events.push({ event: { action: "Logout", userId: user.id }, time: session.endTime, type: "action" });
			});
		});

		this.events = this.events.sort((a, b) => a.time - b.time);

		console.log(`Loaded ${this.events.length} events.`);
	}

	protected loadSessionHistory() {
		const seasonStartTime = new Date(this.season.started).getTime();
		const seasonEndTime = new Date(this.season.ended).getTime();
		this.users.forEach(user => {
			const validSessions = (user.sessions ?? []).filter(s => {
				const validTime = s.startTime || s.endTime;
				return (seasonStartTime == 0 || validTime >= seasonStartTime) && (seasonEndTime == 0 || validTime <= seasonEndTime);
			});

			validSessions.forEach(session => {
				if (session.startTime) this.userHistory[user.id][session.startTime] = `[${new Date(session.startTime).toISOString()}] Login`;
				if (session.endTime) this.userHistory[user.id][session.endTime] = `[${new Date(session.endTime).toISOString()}] Logout`;
			});
		});
	}

	protected async getActiveSeason() {
		if (!fullyOffline) return await this.seasons.collection.findOne({ active: true });

		const manualSeason: Season = {
			id: manualSeasonSelection,
			name: "Manual Selection",
			started: "2020-01-01T00:00:00.000Z",
			ended: null,
			active: true,
			totalRankedUsers: 0,
			endStats: {
				achievementHistory: []
			}
		};

		return manualSeason;
	}

	protected async setupBackUpdate() {
		await this.loadDb();
		this.season = await this.getActiveSeason();
		console.log(`Active season: ${this.season.id} (${this.season.name})`);

		await this.loadUsers();
		await this.loadKillsAndDeaths();
		this.loadEvents();
	}

	protected async collapseHistory() {
		this.users.forEach(u => {
			const history: string[] = [];
			const keys = Object.keys(this.userHistory[u.id]);
			keys.forEach(k => history.push(this.userHistory[u.id][k]));
			delete this.userHistory[u.id];

			u.history = history;
		});
	}

	protected async setupStreamedBackUpdate() {
		await this.loadDb();
		this.season = await this.getActiveSeason();
		console.log(`Active season: ${this.season.id} (${this.season.name})`);

		await this.loadUsers();
		await this.calculateEloMultipliersStreamed();
		this.loadSessionHistory();
		// this.loadEvents();
	}

	public async runStreamedBackUpdate() {
		const start = Date.now();
		await this.setupStreamedBackUpdate();
		console.log(`Streamed setup completed, starting main calculation`);

		await this.streamFile<Kill>(`${this.reportPath}/kills.json`, kill => {
			const timestamp = new Date(kill.time).toISOString();
			const killer = this.usersMap[kill.killer.ownerId];
			const victim = this.usersMap[kill.victim.ownerId];
			const killStr = getKillStr(kill);

			if (!killer || !victim || !shouldKillBeCounted(kill, killer, victim)) {
				this.onInvalidKill(kill, killer, victim);
				return;
			}

			if (kill.killer.team == kill.victim.team) {
				const loss = killer.elo * teamKillPenalty;
				killer.elo -= loss;
				const tkLog = ELOUpdater.getUserLogForTK(timestamp, killer, victim, loss);
				this.userHistory[killer.id][kill.time] = tkLog.victim;
				this.userHistory[victim.id][kill.time] = tkLog.killer;
				killer.eloHistory.push({ elo: killer.elo, time: kill.time });
				return;
			}

			if (killer.ignoreKillsAgainstUsers && killer.ignoreKillsAgainstUsers.includes(victim.id)) return;

			let metric = this.killMultipliers.find(m => m.killStr == killStr);
			let info = "";
			if (kill.weapon == Weapon.CFIT || kill.weapon == Weapon.DCCFIT) {
				const { cfitMetric, extraInfo } = ELOUpdater.getCFITMultiplier(kill, this.killMultipliers);
				if (cfitMetric == null) {
					// this.log.info(`Target was too far away, so CFIT being dropped`);
					victim.deaths++;
					const log = ELOUpdater.getUserLogForDeath(timestamp, victim, 0);
					this.userHistory[victim.id][kill.time] = log;
					return;
				}
				info = extraInfo;
				metric = cfitMetric;
			}

			const aircraftOffset = ELOUpdater.getKillAircraftOffset(kill);
			const eloSteal = ELOUpdater.calculateEloSteal(killer.elo, victim.elo, aircraftOffset, metric?.multiplier ?? 1, this.season.id);

			killer.elo += eloSteal;
			killer.maxElo = Math.max(killer.elo, killer.maxElo);
			victim.elo -= eloSteal;
			victim.elo = Math.max(victim.elo, 1);
			killer.kills++;
			victim.deaths++;

			const log = ELOUpdater.getUserLogForKill(timestamp, killer, victim, metric, kill, eloSteal, killStr, info);
			this.userHistory[killer.id][kill.time] = log.killer;
			this.userHistory[victim.id][kill.time] = log.victim;

			killer.eloHistory.push({ elo: killer.elo, time: kill.time });
			victim.eloHistory.push({ elo: victim.elo, time: kill.time });
			// this.onUserUpdate(killer, e, eloSteal);
			// this.onUserUpdate(victim, e, eloSteal);
		});

		this.collapseHistory();
		console.log(`Primary back update calculations done! Took ${Date.now() - start}ms`);
	}

	public async runBackUpdate() {
		const start = Date.now();
		await this.setupBackUpdate();
		console.log(`Setup completed, starting main calculation`);

		for (let i = 0; i < this.events.length; i++) {
			const e = this.events[i];

			const timestamp = new Date(e.time).toISOString();
			if (e.type == "kill") {
				const kill = e.event as Kill;
				const killer = this.usersMap[kill.killer.ownerId];
				const victim = this.usersMap[kill.victim.ownerId];
				const killStr = getKillStr(kill);

				if (!killer || !victim || !shouldKillBeCounted(kill, killer, victim)) {
					this.onInvalidKill(kill, killer, victim);
					continue;
				}

				if (kill.killer.team == kill.victim.team) {
					const loss = killer.elo * teamKillPenalty;
					killer.elo -= loss;
					ELOUpdater.updateUserLogForTK(timestamp, killer, victim, loss);
					killer.eloHistory.push({ elo: killer.elo, time: e.time });
					this.onUserUpdate(killer, e, 0);
					this.onUserUpdate(victim, e, 0);
					continue;
				}

				if (killer.ignoreKillsAgainstUsers && killer.ignoreKillsAgainstUsers.includes(victim.id)) continue;

				let metric = this.killMultipliers.find(m => m.killStr == killStr);
				let info = "";
				if (kill.weapon == Weapon.CFIT || kill.weapon == Weapon.DCCFIT) {
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

				const aircraftOffset = ELOUpdater.getKillAircraftOffset(kill);
				const eloSteal = ELOUpdater.calculateEloSteal(killer.elo, victim.elo, aircraftOffset, metric?.multiplier ?? 1, this.season.id);

				killer.elo += eloSteal;
				killer.maxElo = Math.max(killer.elo, killer.maxElo);
				victim.elo -= eloSteal;
				victim.elo = Math.max(victim.elo, 1);
				killer.kills++;
				victim.deaths++;

				ELOUpdater.updateUserLogForKill(timestamp, killer, victim, metric, kill, eloSteal, killStr, info);
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

				const eloSteal = ELOUpdater.calculateEloSteal(BASE_ELO, victim.elo, 1, 1, this.season.id);
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

	// protected getSummary(forUser: string, againstUser: string) {
	// 	const user = this.usersMap[forUser];
	// 	const summary = user.eloGainLossSummary[againstUser] ?? { gain: 0, loss: 0 };
	// 	user.eloGainLossSummary[againstUser] = summary;
	// 	return summary;
	// }

	protected onInvalidKill(kill: Kill, killer: User, victim: User) {}

	protected onUserUpdate(user: User, event: EloEvent, eloDelta: number) {
		// switch (event.type) {
		// 	case "kill": {
		// 		const kill = event.event as Kill;
		// 		if (user.id != kill.killer.ownerId) return; // Only run logic once per kill
		// 		const killerSummaryAgainstVictim = this.getSummary(kill.killer.ownerId, kill.victim.ownerId);
		// 		const victimSummaryAgainstKiller = this.getSummary(kill.victim.ownerId, kill.killer.ownerId);
		// 		killerSummaryAgainstVictim.gain += eloDelta;
		// 		victimSummaryAgainstKiller.loss += eloDelta;
		// 		break;
		// 	}
		// 	case "death": {
		// 		if (event.event.killId) return; // Death relates to a kill, don't do anything
		// 		const victimSummaryAgainstVictim = this.getSummary(event.event.victim.ownerId, event.event.victim.ownerId);
		// 		victimSummaryAgainstVictim.loss += eloDelta;
		// 		break;
		// 	}
		// 	case "action":
		// 		break;
		// }
	}

	public async storeResults() {
		console.log(`Beginning store results`);
		const rankedUsers = this.users.filter(u => userCanRank(u)).sort(rankedUserSort);
		this.seasons.collection.updateOne({ id: this.season.id }, { $set: { totalRankedUsers: rankedUsers.length } });
		console.log(`Updated total ranked users to ${rankedUsers.length}`);

		rankedUsers.forEach((user, i) => (user.rank = i + 1));
		this.users.filter(u => !userCanRank(u)).forEach(user => (user.rank = null)); // Un-rank users
		console.log(`Calculated user ranks`);

		const batchSize = 1000;

		const updateActions = this.users
			.map(user => {
				const oldUser = this.oldUsers[user.id];
				const didUserChange =
					Math.round(user.elo) != Math.round(oldUser.elo) || user.rank != oldUser.rank || user.kills != oldUser.kills || user.deaths != oldUser.deaths;
				if (!didUserChange) return null;

				return {
					updateOne: {
						filter: { id: user.id },
						update: {
							$set: {
								elo: user.elo,
								maxElo: user.maxElo,
								kills: user.kills,
								deaths: user.deaths,
								eloHistory: user.eloHistory,
								history: user.history,
								rank: user.rank
								// eloGainLossSummary: user.eloGainLossSummary
							}
						}
					}
				};
			})
			.filter(a => a != null);

		console.log(`About to bulk update ${updateActions.length} users`);
		for (let i = 0; i < updateActions.length; i += batchSize) {
			const chunk = updateActions.slice(i, i + batchSize);

			console.log(`Starting bulk update for ${i} - ${i + batchSize}`);
			await this.userDb.collection.bulkWrite(chunk, { ordered: false });
			console.log(`Finished bulk update for ${i} - ${i + batchSize}`);
		}
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

		console.log(`About to send`);
		const message: IPCMessage = { type: "mults", mults: this.killMultipliers };
		process.send(message);
		console.log(`Sent`);
	}

	public async logResults() {
		const targetPlayerId = "76561198151068299";

		const topPlayers = this.users
			.sort(rankedUserSort)
			.filter(u => userCanRank(u))
			.slice(0, 20);

		topPlayers.forEach((u, idx) => {
			console.log(`${idx + 1}. ${u.pilotNames[0]} - ${u.elo.toFixed(0)}`);
		});

		console.log(`\n\n`);
		const targetPlayer = this.users.find(u => u.id == targetPlayerId);
		const targetPlayerIdx = this.users.findIndex(u => u.id == targetPlayerId);

		console.log(`Target player: ${targetPlayerIdx + 1}. ${targetPlayer.pilotNames[0]} - ${targetPlayer.elo.toFixed(0)}`);
		fs.writeFileSync("../../out-log.txt", targetPlayer.history.join("\n"));
		const result = await createUserEloGraph(targetPlayer);
		console.log(` - Graph path: ${result}`);

		console.log(`\n\n`);
		this.killMultipliers.forEach(m => {
			console.log(`${m.killStr} - ${m.multiplier.toFixed(1)}x (${m.count})`);
		});
	}
}

async function run() {
	const updater = new EloBackUpdater();
	await updater.runStreamedBackUpdate();
	await updater.sendResult();
	if (!fullyOffline) await updater.storeResults();
	else await updater.logResults();

	console.log(`Back update process completely done!`);
	process.exit();
}

if (fullyOffline) {
	run();
}

process.on("message", async msg => {
	if (msg != "start") {
		console.log(`Unknown message: ${msg}`);
		return;
	}

	await run();
});

export { IPCMessage, EloBackUpdater, EloEvent, Action };
