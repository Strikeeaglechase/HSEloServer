import fs from "fs";

import { Aircraft, Kill, User, Weapon } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

interface ExtraUserStats {
	maxElo: number;
	minElo: number;
	streak: number;
	streakWith26b: number;
	longestStreak: number;
	longestStreakWith26b: number;
	killsWithoutTkStreak: number;
	longestKillsWithoutTkStreak: number;
	enemyCollisions: number;
	friendlyCollisions: number;
	totalEloDelta: number;
	timesGotTKed: number;
	killsWithWeapon: Record<Weapon, number>;
	deathsByWeapon: Record<Weapon, number>;
	killsWithAircraft: Record<Aircraft, number>;
	id: string;
}

const strUser = (u: User) => `${u.pilotNames[0] ?? "Unknown"} (${u.id})`;
const killPair = (a: string, b: string) => (a > b ? `${a}-${b}` : `${b}-${a}`);

class InterestingMetricsExtractor extends ProdDBBackUpdater {
	private extraUserStats: Record<string, ExtraUserStats> = {};
	private killPairs: Record<string, number> = {};
	private eloTransfers: Record<string, number> = {};
	private userKillsBySession: Record<string, number[]> = {};

	private eloChangeByF45GunKills = 0;

	// protected async loadDb(): Promise<void> {
	// 	await super.loadDb();

	// 	this.reportPath
	// }

	protected override onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		super.onUserUpdate(user, event, eloDelta);

		const extraStats = this.getUser(user.id);
		extraStats.totalEloDelta += eloDelta;
		if (user.elo > extraStats.maxElo) extraStats.maxElo = user.elo;
		if (user.elo < extraStats.minElo) extraStats.minElo = user.elo;

		if (event.type == "kill") {
			const kill = event.event;
			// Did we get a kill?
			if (kill.killer.ownerId == user.id) {
				if (!extraStats.killsWithWeapon[kill.weapon]) extraStats.killsWithWeapon[kill.weapon] = 0;
				extraStats.killsWithWeapon[kill.weapon]++;
				extraStats.streak++;
				if (extraStats.streak > extraStats.longestStreak) extraStats.longestStreak = extraStats.streak;
				if (kill.killer.type == Aircraft.FA26b) {
					extraStats.streakWith26b++;
					if (extraStats.streakWith26b > extraStats.longestStreakWith26b) extraStats.longestStreakWith26b = extraStats.streakWith26b;
				}

				extraStats.killsWithoutTkStreak++;
				if (kill.killer.team == kill.victim.team) extraStats.killsWithoutTkStreak = 0;
				if (extraStats.killsWithoutTkStreak > extraStats.longestKillsWithoutTkStreak)
					extraStats.longestKillsWithoutTkStreak = extraStats.killsWithoutTkStreak;

				if (!extraStats.killsWithAircraft[kill.killer.type]) extraStats.killsWithAircraft[kill.killer.type] = 0;
				extraStats.killsWithAircraft[kill.killer.type]++;

				// Add to kill pairs
				const pair = killPair(kill.killer.ownerId, kill.victim.ownerId);
				if (!this.killPairs[pair]) this.killPairs[pair] = 0;
				this.killPairs[pair]++;

				// Update elo transfers
				const fromKillerToVictim = `${kill.killer.ownerId}-${kill.victim.ownerId}`;
				const fromVictimToKiller = `${kill.victim.ownerId}-${kill.killer.ownerId}`;
				if (!this.eloTransfers[fromKillerToVictim]) this.eloTransfers[fromKillerToVictim] = 0;
				if (!this.eloTransfers[fromVictimToKiller]) this.eloTransfers[fromVictimToKiller] = 0;

				this.eloTransfers[fromKillerToVictim] -= eloDelta;
				this.eloTransfers[fromVictimToKiller] += eloDelta;

				// Track how much elo was gained from F45A gun kills
				if (kill.killer.type == Aircraft.F45A && kill.weapon == Weapon.Gun) {
					this.eloChangeByF45GunKills += eloDelta;
				}

				// Find session this kill happened in and count
				const s = (user.sessions ?? []).findIndex(s => s.startTime < kill.time && s.endTime > kill.time);
				if (s > -1) {
					if (!this.userKillsBySession[user.id]) this.userKillsBySession[user.id] = [];
					if (!this.userKillsBySession[user.id][s]) this.userKillsBySession[user.id][s] = 0;
					this.userKillsBySession[user.id][s]++;
				}
			} else {
				// Otherwise we were killed
				if (!extraStats.deathsByWeapon[kill.weapon]) extraStats.deathsByWeapon[kill.weapon] = 0;
				extraStats.deathsByWeapon[kill.weapon]++;
				extraStats.streak = 0;
				if (kill.victim.type == Aircraft.FA26b) extraStats.streakWith26b = 0;

				if (kill.killer.team == kill.victim.team) extraStats.timesGotTKed++;
			}
		}
	}

	protected override onInvalidKill(kill: Kill, killer: User, victim: User): void {
		super.onInvalidKill(kill, killer, victim);

		if (kill.weapon == Weapon.Collision && killer && victim && kill.killer.team != kill.victim.team) {
			this.getUser(killer.id).enemyCollisions++;
			this.getUser(victim.id).enemyCollisions++;
		}

		if (kill.weapon == Weapon.Collision && killer && victim && kill.killer.team == kill.victim.team) {
			this.getUser(killer.id).friendlyCollisions++;
			this.getUser(victim.id).friendlyCollisions++;
		}
	}

	private getUser(id: string) {
		if (!this.extraUserStats[id]) {
			this.extraUserStats[id] = {
				maxElo: -Infinity,
				minElo: Infinity,
				id: id,
				streak: 0,
				longestStreak: 0,
				streakWith26b: 0,
				longestStreakWith26b: 0,
				totalEloDelta: 0,
				timesGotTKed: 0,
				killsWithoutTkStreak: 0,
				longestKillsWithoutTkStreak: 0,
				enemyCollisions: 0,
				friendlyCollisions: 0,
				killsWithWeapon: {} as Record<Weapon, number>,
				deathsByWeapon: {} as Record<Weapon, number>,

				killsWithAircraft: {} as Record<Aircraft, number>
			};
		}

		return this.extraUserStats[id];
	}

	private findHighestDeltaUser() {
		let highestDelta = -Infinity;
		let highestUser: ExtraUserStats;

		for (const user of Object.values(this.extraUserStats)) {
			const delta = user.maxElo - user.minElo;
			if (delta > highestDelta) {
				highestDelta = delta;
				highestUser = user;
			}
		}

		const rUser = this.usersMap[highestUser.id];
		console.log(
			`${strUser(rUser)} had the highest elo delta of ${Math.round(highestDelta)}, reaching a peak of ${Math.round(
				highestUser.maxElo
			)} and a low of ${Math.round(highestUser.minElo)}`
		);
	}

	private findHighestDeltaUserBelow4k() {
		let highestDelta = -Infinity;
		let highestUser: ExtraUserStats;

		for (const user of Object.values(this.extraUserStats)) {
			const rUser = this.usersMap[user.id];
			if (rUser.elo > 4000) continue;

			const delta = user.maxElo - user.minElo;
			if (delta > highestDelta) {
				highestDelta = delta;
				highestUser = user;
			}
		}

		const rUser = this.usersMap[highestUser.id];
		console.log(
			`${strUser(rUser)} had the highest elo delta of ${Math.round(highestDelta)} (for users below 4k elo), reaching a peak of ${Math.round(
				highestUser.maxElo
			)} and a low of ${Math.round(highestUser.minElo)}`
		);
	}

	private findHighestFallAtEnd() {
		let highestDelta = -Infinity;
		let highestUser: ExtraUserStats;

		for (const user of Object.values(this.extraUserStats)) {
			const rUser = this.usersMap[user.id];
			const delta = user.maxElo - rUser.elo;
			if (delta > highestDelta) {
				highestDelta = delta;
				highestUser = user;
			}
		}

		const rUser = this.usersMap[highestUser.id];
		console.log(
			`${strUser(rUser)} ended the season the farthest down from where they were. At one point reaching ${Math.round(
				highestUser.maxElo
			)} but ending the season at ${Math.round(rUser.elo)}`
		);
	}

	private findHighestKills() {
		let highestKills = -Infinity;
		let highestUser: User;
		this.users.forEach(user => {
			if (user.kills > highestKills) {
				highestKills = user.kills;
				highestUser = user;
			}
		});

		console.log(`${strUser(highestUser)} had the most kills with ${highestKills}`);
	}

	private findHighestDeaths() {
		let highestDeaths = -Infinity;
		let highestUser: User;
		this.users.forEach(user => {
			if (user.deaths > highestDeaths) {
				highestDeaths = user.deaths;
				highestUser = user;
			}
		});

		console.log(`${strUser(highestUser)} had the most deaths with ${highestDeaths}`);
	}

	private findBestKDRWithMoreThan30Kills() {
		let highestKDR = -Infinity;
		let highestUser: User;
		this.users.forEach(user => {
			if (user.kills < 30) return;
			const kdr = user.kills / user.deaths;
			if (kdr > highestKDR) {
				highestKDR = kdr;
				highestUser = user;
			}
		});

		console.log(`${strUser(highestUser)} had the highest KDR with ${highestKDR}`);
	}

	private findMostTKs() {
		let highestTKs = -Infinity;
		let highestUser: User;
		this.users.forEach(user => {
			if (user.teamKills > highestTKs) {
				highestTKs = user.teamKills;
				highestUser = user;
			}
		});

		console.log(`${strUser(highestUser)} had the most team kills with ${highestTKs}  ${((highestTKs / highestUser.kills) * 100).toFixed(2)}% of their kills`);
	}

	private findMostKillsPerWeaponType() {
		const highestKillsPerWeaponType: Record<Weapon, { kills: number; user: ExtraUserStats }> = {} as Record<Weapon, { kills: number; user: ExtraUserStats }>;
		for (const user of Object.values(this.extraUserStats)) {
			for (const weapon of Object.keys(user.killsWithWeapon)) {
				if (!highestKillsPerWeaponType[weapon]) highestKillsPerWeaponType[weapon] = { kills: -Infinity, user: null };

				if (user.killsWithWeapon[weapon] > highestKillsPerWeaponType[weapon].kills) {
					highestKillsPerWeaponType[weapon].kills = user.killsWithWeapon[weapon];
					highestKillsPerWeaponType[weapon].user = user;
				}
			}
		}

		for (const weapon of Object.keys(highestKillsPerWeaponType)) {
			const user = highestKillsPerWeaponType[weapon].user;
			const rUser = this.usersMap[user.id];
			console.log(`${strUser(rUser)} had the most kills with ${Weapon[weapon]} with ${highestKillsPerWeaponType[weapon].kills} kills`);
		}
	}

	private findMostDeathsByWeaponType() {
		const deathsPerWeaponType: Record<Weapon, { deaths: number; user: ExtraUserStats }> = {} as Record<Weapon, { deaths: number; user: ExtraUserStats }>;
		for (const user of Object.values(this.extraUserStats)) {
			for (const weapon of Object.keys(user.deathsByWeapon)) {
				if (!deathsPerWeaponType[weapon]) deathsPerWeaponType[weapon] = { deaths: -Infinity, user: null };

				if (user.deathsByWeapon[weapon] > deathsPerWeaponType[weapon].deaths) {
					deathsPerWeaponType[weapon].deaths = user.deathsByWeapon[weapon];
					deathsPerWeaponType[weapon].user = user;
				}
			}
		}

		for (const weapon of Object.keys(deathsPerWeaponType)) {
			const user = deathsPerWeaponType[weapon].user;
			const rUser = this.usersMap[user.id];
			console.log(`${strUser(rUser)} had the most deaths to ${Weapon[weapon]} with ${deathsPerWeaponType[weapon].deaths} deaths`);
		}
	}

	private findLongestStreak() {
		let longestStreak = -Infinity;
		let longestUser: ExtraUserStats;

		for (const user of Object.values(this.extraUserStats)) {
			if (user.longestStreak > longestStreak) {
				longestStreak = user.longestStreak;
				longestUser = user;
			}
		}

		const rUser = this.usersMap[longestUser.id];
		console.log(`${strUser(rUser)} had the longest streak with ${longestStreak} kills without dying`);
	}

	private findLongestStreakWith26b() {
		let longestStreak = -Infinity;
		let longestUser: ExtraUserStats;

		for (const user of Object.values(this.extraUserStats)) {
			if (user.longestStreakWith26b > longestStreak) {
				longestStreak = user.longestStreakWith26b;
				longestUser = user;
			}
		}

		const rUser = this.usersMap[longestUser.id];
		console.log(`${strUser(rUser)} had the longest streak with the 26b with ${longestStreak} kills without dying`);
	}

	private findTop45OnlyPlayer() {
		let highestElo = -Infinity;
		let highestUser: User;

		this.users.forEach(user => {
			if (user.elo > highestElo) {
				const stats = this.getUser(user.id);
				const ratio = stats.killsWithAircraft[Aircraft.F45A] / ((stats.killsWithAircraft[Aircraft.FA26b] ?? 0) + stats.killsWithAircraft[Aircraft.F45A]);
				if (ratio > 0.9) {
					// 90% of kills with the F45A
					highestElo = user.elo;
					highestUser = user;
				}
			}
		});

		console.log(`${strUser(highestUser)} is the top 45 only player, with ${Math.round(highestUser.elo)} elo`);
	}

	private findBiggestRivals() {
		let biggestPairKills = -Infinity;
		let biggestPair: string;

		for (const pair of Object.keys(this.killPairs)) {
			if (this.killPairs[pair] > biggestPairKills) {
				biggestPairKills = this.killPairs[pair];
				biggestPair = pair;
			}
		}

		const [a, b] = biggestPair.split("-");
		const userA = this.usersMap[a];
		const userB = this.usersMap[b];

		console.log(`${strUser(userA)} and ${strUser(userB)} were the biggest rivals, with ${biggestPairKills} kills between them`);
	}

	private findBiggestEloTransfer() {
		let biggestTransfer = -Infinity;
		let biggestPair: string;

		for (const pair of Object.keys(this.eloTransfers)) {
			if (this.eloTransfers[pair] > biggestTransfer) {
				biggestTransfer = this.eloTransfers[pair];
				biggestPair = pair;
			}
		}

		const [a, b] = biggestPair.split("-");
		const userA = this.usersMap[a];
		const userB = this.usersMap[b];

		console.log(`${strUser(userA)} sent the most ELO to a single user, ${strUser(userB)} sending a total of ${Math.round(biggestTransfer)} elo`);
	}

	private findHighestEloDelta() {
		let highestDelta = -Infinity;
		let highestUser: ExtraUserStats;

		for (const user of Object.values(this.extraUserStats)) {
			if (user.totalEloDelta > highestDelta) {
				highestDelta = user.totalEloDelta;
				highestUser = user;
			}
		}

		const rUser = this.usersMap[highestUser.id];
		console.log(`${strUser(rUser)} had the highest elo delta of ${Math.round(highestDelta)}`);
	}

	private findMostTKed() {
		let highestTKs = -Infinity;
		let highestUser: User;

		let results: { name: string; times: number }[] = [];
		for (const user of Object.values(this.extraUserStats)) {
			if (user.timesGotTKed > highestTKs) {
				highestTKs = user.timesGotTKed;
				highestUser = this.usersMap[user.id];
			}

			results.push({
				name: this.usersMap[user.id].pilotNames[0] ?? "Unknown",
				times: user.timesGotTKed
			});
		}

		let out = "";
		results
			.sort((a, b) => b.times - a.times)
			.forEach((r, i) => {
				out += `${i + 1}. ${r.name}: ${r.times}\n`;
			});
		fs.writeFileSync("../../../out.txt", out);

		console.log(`${strUser(highestUser)} was TKed the most with ${highestTKs} times`);
	}

	private findMostAchievements() {
		let highestAchievements = -Infinity;
		let highestUser: User;

		let highestFirstFoundAchievements = -Infinity;
		let highestFirstFoundUser: User;

		this.users.forEach(user => {
			const uniqueAchievements = new Set(user.achievements.map(a => a.id));
			if (uniqueAchievements.size > highestAchievements) {
				highestAchievements = user.achievements.length;
				highestUser = user;
			}

			// const firstFound = user.achievements.filter(a => a.firstAchieved);
			// if (firstFound.length > highestFirstFoundAchievements) {
			// 	highestFirstFoundAchievements = firstFound.length;
			// 	highestFirstFoundUser = user;
			// }
		});

		console.log(`${strUser(highestUser)} had the most achievements with ${highestAchievements}`);
		// console.log(`${strUser(highestFirstFoundUser)} had the most first found achievements with ${highestFirstFoundAchievements}`);
	}

	private findLongestNoTKStreak() {
		let longestStreak = -Infinity;
		let longestUser: User;

		this.users.forEach(user => {
			const stats = this.getUser(user.id);
			if (stats.killsWithoutTkStreak > longestStreak) {
				longestStreak = stats.killsWithoutTkStreak;
				longestUser = user;
			}
		});

		console.log(`${strUser(longestUser)} had the longest streak without a teamkill with ${longestStreak} kills`);
	}

	private findMostCollisions() {
		let mostEnemyCollisions = -Infinity;
		let mostEnemyColUser: User;

		let mostFriendlyCollisions = -Infinity;
		let mostFriendlyColUser: User;

		this.users.forEach(user => {
			if (user.id == "76561198008478379") return;
			const stats = this.getUser(user.id);
			if (stats.enemyCollisions > mostEnemyCollisions) {
				mostEnemyCollisions = stats.enemyCollisions;
				mostEnemyColUser = user;
			}

			if (stats.friendlyCollisions > mostFriendlyCollisions) {
				mostFriendlyCollisions = stats.friendlyCollisions;
				mostFriendlyColUser = user;
			}
		});

		console.log(`${strUser(mostEnemyColUser)} had the most collisions with enemies: ${mostEnemyCollisions}`);
		console.log(`${strUser(mostFriendlyColUser)} had the most collisions with friendlies: ${mostFriendlyCollisions}`);
	}

	private findMostFooledUser() {
		let mostFooled = -Infinity;
		let mostFooledUser: User;

		this.users.forEach(user => {
			const fooled = user.achievements.filter(a => a.id == "fooled").length;
			if (fooled > 0) console.log(`${strUser(user)} was fooled ${fooled} times`);
			if (fooled > mostFooled) {
				mostFooled = fooled;
				mostFooledUser = user;
			}
		});

		console.log(`${strUser(mostFooledUser)} was fooled the most with ${mostFooled} times`);
	}

	private getUserPlayTimeHrs(user: User, seasonStartTime: number) {
		// (user.sessions ?? [])
		// 	.filter(s => s.startTime > seasonStartTime && !!s.endTime)
		// 	.forEach(s => {
		// 		const dur = s.endTime - s.startTime;
		// 		if (dur < 0) {
		// 			console.log(`Negative duration for ${user.pilotNames[0]}: ${new Date(s.startTime)} - ${new Date(s.endTime)}`);
		// 		}
		// 		if (dur > 1000 * 60 * 60 * 1.1) {
		// 			console.log(`Duration over a one hour for ${user.pilotNames[0]}: ${new Date(s.startTime)} - ${new Date(s.endTime)}`);
		// 		}
		// 	});

		const userPlayTimeMs = (user.sessions ?? [])
			.filter(s => s.startTime > seasonStartTime && !!s.endTime)
			.map(s => s.endTime - s.startTime)
			.filter(s => s > 0 && s < 1000 * 60 * 60 * 1.1) // Ignore negative durations and durations over an hour
			.reduce((acc, s) => acc + s, 0);

		return userPlayTimeMs / 1000 / 60 / 60; // Convert to hours
	}

	private async findBestKPH() {
		let highestKPH = -Infinity;
		let highestUser: User;

		const seasonStartTime = new Date((await this.getActiveSeason()).started).getTime();
		this.users.forEach(user => {
			const userPlayTimeHr = this.getUserPlayTimeHrs(user, seasonStartTime);
			if (userPlayTimeHr < 5) return; // Ignore users with less than 5 hours of playtime

			const kph = user.kills / userPlayTimeHr;
			if (kph > highestKPH) {
				highestKPH = kph;
				highestUser = user;
			}
		});

		console.log(
			`${strUser(highestUser)} had the best KPH, getting ${highestUser.kills} in ${this.getUserPlayTimeHrs(
				highestUser,
				seasonStartTime
			)}hrs. ${highestKPH} KPH`
		);
	}

	private findBestSession() {
		let bestSessionKills = -Infinity;
		let bestSessionUser: User;
		let bestSessionIdx = -1;

		this.users.forEach(user => {
			(user.sessions ?? []).forEach((session, i) => {
				if (!this.userKillsBySession[user.id]) return;

				const kills = this.userKillsBySession[user.id][i];
				if (kills > bestSessionKills) {
					bestSessionKills = kills;
					bestSessionUser = user;
					bestSessionIdx = i;
				}
			});
		});

		const session = bestSessionUser.sessions[bestSessionIdx];
		const startTime = new Date(session.startTime);
		const endTime = new Date(session.endTime);
		console.log(
			`${strUser(bestSessionUser)} had the best session with ${bestSessionKills} kills. ${startTime.toLocaleString()} - ${endTime.toLocaleString()}`
		);
	}

	private findTopSessions() {
		const bestSessions = this.users.map(user => {
			let userBestSessionKills = -Infinity;
			let userBestSessionIdx = -1;
			(user.sessions ?? []).forEach((session, i) => {
				if (!this.userKillsBySession[user.id]) return;

				const kills = this.userKillsBySession[user.id][i];
				if (kills > userBestSessionKills) {
					userBestSessionKills = kills;
					userBestSessionIdx = i;
				}
			});

			return {
				user,
				bestSessionKills: userBestSessionKills,
				bestSessionIdx: userBestSessionIdx
			};
		});

		bestSessions.sort((a, b) => b.bestSessionKills - a.bestSessionKills);
		for (let i = 0; i < 10; i++) {
			const { user, bestSessionKills, bestSessionIdx } = bestSessions[i];

			const session = user.sessions[bestSessionIdx];
			const startTime = new Date(session.startTime);
			const endTime = new Date(session.endTime);
			console.log(
				`${i + 1}. ${strUser(user)} had the best session with ${bestSessionKills} kills. ${startTime.toLocaleString()} - ${endTime.toLocaleString()}`
			);
		}
	}

	private async findTopPlaytime() {
		const seasonStartTime = new Date((await this.getActiveSeason()).started).getTime();
		const playtime = this.users.map(user => {
			const userPlayTimeHr = this.getUserPlayTimeHrs(user, seasonStartTime);
			return {
				user,
				playtime: userPlayTimeHr
			};
		});

		playtime.sort((a, b) => b.playtime - a.playtime);
		for (let i = 0; i < 10; i++) {
			const { user, playtime: playHrs } = playtime[i];
			console.log(`${i + 1}. ${strUser(user)} had ${playHrs} hours of playtime`);
		}
	}

	private findF45GunEloTransfer() {
		console.log(`Elo gained from F45A gun kills: ${this.eloChangeByF45GunKills}`);
	}

	public async getMetrics() {
		console.log(`----- Metrics -----`);
		this.findHighestDeltaUser();
		this.findHighestDeltaUserBelow4k();
		this.findHighestFallAtEnd();
		this.findHighestKills();
		this.findHighestDeaths();
		this.findBestKDRWithMoreThan30Kills();
		this.findMostTKs();
		this.findMostKillsPerWeaponType();
		// this.findMostDeathsByWeaponType();
		this.findLongestStreak();
		this.findLongestStreakWith26b();
		this.findTop45OnlyPlayer();
		this.findBiggestRivals();
		this.findBiggestEloTransfer();
		this.findHighestEloDelta();
		this.findMostTKed();
		this.findMostAchievements();
		this.findLongestNoTKStreak();
		this.findMostCollisions();
		this.findMostFooledUser();
		await this.findBestKPH();
		this.findBestSession();
		this.findF45GunEloTransfer();
		// await this.findTopPlaytime();

		// const u = this.usersMap["76561198177819141"];
		// fs.writeFileSync("../../out-log.txt", u.history.join("\n"));

		// let out = ``;
		// this.users.map(u => {
		// 	return {
		// 		u: u,
		// 		kdr: u.kills / u.deaths
		// 	};
		// })
		// 	.filter(u => !isNaN(u.kdr))
		// 	.sort((a, b) => b.kdr - a.kdr)
		// 	.forEach((u, i) => {
		// 		out += `${i + 1}. ${strUser(u.u)}: ${u.kdr.toFixed(2)}\n`;
		// 	});
		// fs.writeFileSync("../../out.txt", out);
	}
}

async function getInterestingMetrics() {
	const updater = new InterestingMetricsExtractor();
	await updater.runBackUpdate();
	await updater.getMetrics();
}

getInterestingMetrics();
