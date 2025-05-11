import Database from "../../db/database.js";
import { Aircraft, Kill, Season, User, Weapon } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { loadFileStreamedCb, ProdDBBackUpdater } from "./eloUtils.js";

class CardStatsUpdater extends ProdDBBackUpdater {
	private userAircraftEloGained: Record<string, Record<Aircraft, number>> = {};

	public override onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		super.onUserUpdate(user, event, eloDelta);

		if (event.type !== "kill") return;

		const kill = event.event;
		if (kill.killer.ownerId != user.id) return;

		const killerUserStats = this.getStats(kill.killer.ownerId);
		const victimUserStats = this.getStats(kill.victim.ownerId);

		killerUserStats[kill.killer.type] += eloDelta;
		victimUserStats[kill.victim.type] -= eloDelta;

		this.userAircraftEloGained[kill.killer.ownerId] = killerUserStats;
		this.userAircraftEloGained[kill.victim.ownerId] = victimUserStats;
	}

	private getStats(id: string) {
		return (
			this.userAircraftEloGained[id] ?? {
				[Aircraft.AV42c]: 0,
				[Aircraft.FA26b]: 0,
				[Aircraft.F45A]: 0,
				[Aircraft.AH94]: 0,
				[Aircraft.Invalid]: 0,
				[Aircraft.T55]: 0,
				[Aircraft.EF24G]: 0
			}
		);
	}

	public log() {
		const sortedPlayers = this.users.toSorted((a, b) => b.elo - a.elo);
		const playersWithDiscordId = sortedPlayers; //.filter(u => !!u.discordId);
		const top52PlayersWithDiscordId = playersWithDiscordId.slice(0, 250);

		const aircraft = [Aircraft.F45A, Aircraft.FA26b, Aircraft.T55, Aircraft.EF24G];
		let result = "Top 52 players:\n";
		top52PlayersWithDiscordId.forEach((user, i) => {
			const gIdx = sortedPlayers.findIndex(u => u.id === user.id);
			const aircraftEloGained = aircraft
				.map(aircraft => {
					const count = this.userAircraftEloGained[user.id]?.[aircraft] ?? 0;
					return `${Aircraft[aircraft]}: ${count.toFixed(0)}`;
				})
				.join(", ");

			result += `${i + 1}/${gIdx + 1}) ${user.discordId} - ${user.pilotNames[0]} (${user.id}) ${user.elo.toFixed(0)}. ${aircraftEloGained}\n`;
		});
		console.log(result);

		// const aircraft = [Aircraft.F45A, Aircraft.FA26b, Aircraft.T55, Aircraft.EF24G];
		// aircraft.forEach(aircraft => {
		// 	const users = playersWithDiscordId.map(user => ({ user, kills: this.userAircraftKills[user.id]?.[aircraft] ?? 0 }));
		// 	const n = 30;
		// 	const topPlayers = users.sort((a, b) => b.kills - a.kills).slice(0, n);
		// 	let aircraftResult = `Top ${n} players with ${Aircraft[aircraft]}:\n`;
		// 	topPlayers.forEach((user, i) => {
		// 		aircraftResult += `${i + 1}) ${user.user.discordId} - ${user.user.pilotNames[0]} (${user.user.id}) ${user.kills} ${user.user.elo.toFixed(0)} \n`;
		// 	});

		// 	console.log(aircraftResult);
		// });
	}
}

async function runCardStats() {
	const updater = new CardStatsUpdater();
	await updater.runBackUpdate();
	updater.log();
}

function getUserStatObject(user: User, killsMap: Record<string, Kill[]>, kills: Kill[], seasons: Season) {
	let maxElo = 0;
	user.eloHistory.forEach(h => (maxElo = Math.max(maxElo, h.elo)));

	// if (!killsMap[user.id]) {
	// 	console.log(user);
	// }
	const numKills = killsMap[user.id].length;
	const numDeaths = kills.filter(kill => kill.victim.ownerId === user.id).length;

	const killsWith26b = killsMap[user.id].filter(kill => kill.killer.type === Aircraft.FA26b).length;
	const killsWithF45A = killsMap[user.id].filter(kill => kill.killer.type === Aircraft.F45A).length;
	const killsWithT55 = killsMap[user.id].filter(kill => kill.killer.type === Aircraft.T55).length;
	const killsWithEF24G = killsMap[user.id].filter(kill => kill.killer.type === Aircraft.EF24G).length;

	const killsAgainst26b = killsMap[user.id].filter(kill => kill.victim.type === Aircraft.FA26b).length;
	const killsAgainstF45A = killsMap[user.id].filter(kill => kill.victim.type === Aircraft.F45A).length;
	const killsAgainstT55 = killsMap[user.id].filter(kill => kill.victim.type === Aircraft.T55).length;
	const killsAgainstEF24G = killsMap[user.id].filter(kill => kill.victim.type === Aircraft.EF24G).length;

	const weapons = [Weapon.AIM120, Weapon.AIM54, Weapon.AIM7, Weapon.AIM9, Weapon.AIM9E, Weapon.AIM9X, Weapon.AIRST, Weapon.Gun, Weapon.HARM, Weapon.Collision];
	const killsWithWeapons = {};
	const deathsToWeapons = {};

	weapons.forEach(weapon => {
		killsWithWeapons[`killsWith${Weapon[weapon]}`] = killsMap[user.id].filter(kill => kill.weapon == weapon).length;
		deathsToWeapons[`deathsTo${Weapon[weapon]}`] = kills.filter(kill => kill.victim.ownerId == user.id && kill.weapon == weapon).length;
	});

	return {
		elo: user.elo,
		rank: user.rank,
		topPrec: (user.rank / seasons.totalRankedUsers) * 100,
		peakElo: maxElo,

		kills: numKills,
		deaths: numDeaths,
		kdr: numKills / Math.max(1, numDeaths),

		killsWith26b,
		killsWithF45A,
		killsWithT55,
		killsWithEF24G,

		killsAgainst26b,
		killsAgainstF45A,
		killsAgainstT55,
		killsAgainstEF24G,

		...killsWithWeapons,
		...deathsToWeapons
	};
}

async function runNewCardStats() {
	const db = new Database(
		{
			databaseName: "vtol-server-elo",
			url: process.env.PROD_DB_URL
		},
		console.log
	);
	await db.init();
	const seasonsDb = await db.collection<Season>("seasons", false, "id");
	const userDb = await db.collection<User>("users", false, "id");

	const activeSeason = await seasonsDb.collection.findOne({ active: true });
	const users = await userDb.collection.find({}).toArray();

	const usersWithDids = users
		.filter(user => !!user.discordId && user.discordId != "")
		.sort((a, b) => b.elo - a.elo)
		.slice(0, 128);

	const kills: Record<string, Kill[]> = {};
	const allKills: Kill[] = [];
	await loadFileStreamedCb<Kill>("../../../prodHourlyReport/kills.json", kill => {
		if (!kills[kill.killer.ownerId]) kills[kill.killer.ownerId] = [];
		kills[kill.killer.ownerId].push(kill);

		allKills.push(kill);
	});

	const averagesObj = {};
	usersWithDids.forEach((user, idx) => {
		const stats = getUserStatObject(user, kills, allKills, activeSeason);
		console.log(idx);
		// if (idx == 0) console.log(stats);

		for (const key in stats) {
			if (!averagesObj[key]) averagesObj[key] = 0;
			averagesObj[key] += stats[key];
		}
	});

	for (const key in averagesObj) {
		averagesObj[key] /= usersWithDids.length;

		console.log(`${key}: ${averagesObj[key]}`);
	}
}

// runCardStats();
runNewCardStats();
