import fs from "fs";

import Database from "../../db/database.js";
import { MissileLaunchParams, Team, User } from "../../structures.js";
import { createPullStream, loadFileStreamed } from "./eloUtils.js";

async function getDb() {
	const db = new Database(
		{
			databaseName: "vtol-server-elo",
			url: process.env.PROD_DB_URL
		},
		console.log
	);
	await db.init();
	return db;
}

async function pullMissiles() {
	const db = await getDb();

	return createPullStream(db, "missiles", "missiles", { season: 4 });
}
// await pullMissiles().then(c => console.log(`Downloaded ${c} missiles`));

async function run() {
	const db = await getDb();
	const usersCollection = await db.collection<User>("users", false, "id");
	const users = await usersCollection.collection.find().toArray();
	const usersMap: Record<string, User> = {};
	const usersAverageFoughtElo: Record<string, { total: number; count: number }> = {};
	users.forEach(user => (usersMap[user.id] = user));

	const mlps = await loadFileStreamed<MissileLaunchParams>("../../../prodHourlyReport/missiles.json");
	let userImbalanceValues: number[] = [];
	const eloData = mlps.map(mlp => {
		let min = Infinity;
		let max = -Infinity;
		let totalTeamA = 0;
		let totalTeamB = 0;

		mlp.players.forEach(player => {
			const user = usersMap[player.ownerId];
			if (!user) return;

			min = Math.min(min, user.elo);
			max = Math.max(max, user.elo);
			if (player.team == Team.Allied) totalTeamA += user.elo;
			else totalTeamB += user.elo;
		});

		const avgA = totalTeamA / mlp.players.length;
		const avgB = totalTeamB / mlp.players.length;

		mlp.players.forEach(player => {
			const user = usersMap[player.ownerId];
			if (!user) {
				console.log(`User ${player.ownerId} not found`);
				return;
			}

			const totalEloOwnTeam = (player.team == Team.Allied ? totalTeamA : totalTeamB) - user.elo;
			const averageEloOwnTeam = totalEloOwnTeam / (mlp.players.length - 1);
			const averageEloOtherTeam = player.team == Team.Allied ? avgB : avgA;

			if (user.id == "76561198200904090") {
				if (userImbalanceValues.length == 0) userImbalanceValues.push(Math.floor(averageEloOwnTeam - averageEloOtherTeam));
				let prev = userImbalanceValues[userImbalanceValues.length - 1];
				let cur = Math.floor(averageEloOwnTeam - averageEloOtherTeam);
				if (prev != cur) userImbalanceValues.push(averageEloOwnTeam - averageEloOtherTeam);
			}
			if (!usersAverageFoughtElo[user.id]) usersAverageFoughtElo[user.id] = { total: 0, count: 0 };
			if (Math.abs(averageEloOwnTeam - averageEloOtherTeam) > 100) {
				const delta = Math.abs(averageEloOwnTeam - averageEloOtherTeam);
				const sign = Math.sign(averageEloOwnTeam - averageEloOtherTeam);
				usersAverageFoughtElo[user.id].total += sign * delta;
				usersAverageFoughtElo[user.id].count++;
			}
		});

		return {
			min,
			max,
			avgA,
			avgB
		};
	});

	let csv = "min,max,avgA,avgB\n";
	eloData.forEach(data => (csv += `${data.min},${data.max},${data.avgA},${data.avgB}\n`));

	fs.writeFileSync("../../../eloTeamAvgs.csv", csv);
	fs.writeFileSync("../../../eloImbalanceValues.csv", userImbalanceValues.map((v, idx) => idx / userImbalanceValues.length + " " + v).join("\n"));

	const sortedUsers = users.sort((a, b) => b.elo - a.elo);
	const topThirty = sortedUsers.slice(0, 30);
	topThirty.forEach(user => {
		const avg = usersAverageFoughtElo[user.id].total / usersAverageFoughtElo[user.id].count;
		console.log(`${user.pilotNames[0]} (${user.id}). ${user.elo.toFixed(0)}, Imbalance factor: ${avg.toFixed(0)}`);
	});

	console.log("Done");
}

run();
