import { Aircraft, User, Weapon } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

interface ExtraUserStats {
	maxElo: number;
	minElo: number;
	streak: number;
	streakWith26b: number;
	totalEloDelta: number;
	killsWithWeapon: Record<Weapon, number>;
	deathsByWeapon: Record<Weapon, number>;
	killsWithAircraft: Record<Aircraft, number>;
	id: string;
}

const strUser = (u: User) => `${u.pilotNames[0] ?? "Unknown"} (${u.id})`;
const killPair = (a: string, b: string) => a > b ? `${a}-${b}` : `${b}-${a}`;


class InterestingMetricsExtractor extends ProdDBBackUpdater {
	private extraUserStats: Record<string, ExtraUserStats> = {};
	private killPairs: Record<string, number> = {};
	private eloTransfers: Record<string, number> = {};

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
				if (kill.killer.type == Aircraft.FA26b) extraStats.streakWith26b++;

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
			} else {
				// Otherwise we were killed
				if (!extraStats.deathsByWeapon[kill.weapon]) extraStats.deathsByWeapon[kill.weapon] = 0;
				extraStats.deathsByWeapon[kill.weapon]++;
				extraStats.streak = 0;
				if (kill.victim.type == Aircraft.FA26b) extraStats.streakWith26b = 0;
			}
		}
	}

	private getUser(id: string) {
		if (!this.extraUserStats[id]) {
			this.extraUserStats[id] = {
				maxElo: -Infinity,
				minElo: Infinity,
				id: id,
				streak: 0,
				streakWith26b: 0,
				totalEloDelta: 0,
				killsWithWeapon: {} as Record<Weapon, number>,
				deathsByWeapon: {} as Record<Weapon, number>,

				killsWithAircraft: {} as Record<Aircraft, number>,
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
		console.log(`${strUser(rUser)} had the highest elo delta of ${Math.round(highestDelta)}, reaching a peak of ${Math.round(highestUser.maxElo)} and a low of ${Math.round(highestUser.minElo)}`);
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
		console.log(`${strUser(rUser)} had the highest elo delta of ${Math.round(highestDelta)} (for users below 4k elo), reaching a peak of ${Math.round(highestUser.maxElo)} and a low of ${Math.round(highestUser.minElo)}`);
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
		console.log(`${strUser(rUser)} ended the season the farthest down from where they were. At one point reaching ${Math.round(highestUser.maxElo)} but ending the season at ${Math.round(rUser.elo)}`);
	}

	private findHighestKills() {
		let highestKills = -Infinity;
		let highestUser: User;
		this.users.forEach((user) => {
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
		this.users.forEach((user) => {
			if (user.deaths > highestDeaths) {
				highestDeaths = user.deaths;
				highestUser = user;
			}
		});

		console.log(`${strUser(highestUser)} had the most deaths with ${highestDeaths}`);
	}

	private findBestKDRWithMoreThan10Kills() {
		let highestKDR = -Infinity;
		let highestUser: User;
		this.users.forEach((user) => {
			if (user.kills < 10) return;
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
		this.users.forEach((user) => {
			if (user.teamKills > highestTKs) {
				highestTKs = user.teamKills;
				highestUser = user;
			}
		});

		console.log(`${strUser(highestUser)} had the most team kills with ${highestTKs}  ${(highestTKs / highestUser.kills * 100).toFixed(2)}% of their kills`);
	}

	private findMostKillsPerWeaponType() {
		const highestKillsPerWeaponType: Record<Weapon, { kills: number, user: ExtraUserStats; }> = {} as Record<Weapon, { kills: number, user: ExtraUserStats; }>;
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
		const deathsPerWeaponType: Record<Weapon, { deaths: number, user: ExtraUserStats; }> = {} as Record<Weapon, { deaths: number, user: ExtraUserStats; }>;
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
			if (user.streak > longestStreak) {
				longestStreak = user.streak;
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
			if (user.streakWith26b > longestStreak) {
				longestStreak = user.streakWith26b;
				longestUser = user;
			}
		}

		const rUser = this.usersMap[longestUser.id];
		console.log(`${strUser(rUser)} had the longest streak with the 26b with ${longestStreak} kills without dying`);
	}

	private findTop45OnlyPlayer() {
		let highestElo = -Infinity;
		let highestUser: User;

		this.users.forEach((user) => {
			if (user.elo > highestElo) {
				const stats = this.getUser(user.id);
				const ratio = stats.killsWithAircraft[Aircraft.F45A] / ((stats.killsWithAircraft[Aircraft.FA26b] ?? 0) + stats.killsWithAircraft[Aircraft.F45A]);
				if (ratio > 0.9) {  // 90% of kills with the F45A
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

	public getMetrics() {
		console.log(`----- Metrics -----`);
		this.findHighestDeltaUser();
		this.findHighestDeltaUserBelow4k();
		this.findHighestFallAtEnd();
		this.findHighestKills();
		this.findHighestDeaths();
		this.findBestKDRWithMoreThan10Kills();
		this.findMostTKs();
		// this.findMostKillsPerWeaponType();
		// this.findMostDeathsByWeaponType();
		this.findLongestStreak();
		this.findLongestStreakWith26b();
		this.findTop45OnlyPlayer();
		this.findBiggestRivals();
		this.findBiggestEloTransfer();
		this.findHighestEloDelta();

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
	updater.getMetrics();
}

getInterestingMetrics();