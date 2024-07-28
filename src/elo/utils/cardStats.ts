import { Aircraft, User } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

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

runCardStats();
