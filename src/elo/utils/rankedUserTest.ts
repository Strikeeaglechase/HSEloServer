import fs from "fs";

import { Aircraft } from "../../structures.js";
import { userCanRank } from "../eloUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

/*
top #30 -> Master
top 3% -> Diamond
top 6% -> Platinum
top 18% -> Gold
top 40% -> Silver
top 80% --> Bronze
top 100% --> Copper
*/
function getUserRank(place: number, totalUsers: number) {
	if (place <= 30) return "Master";
	const p = place / totalUsers;
	if (p <= 0.03) return "Diamond";
	if (p <= 0.06) return "Platinum";
	if (p <= 0.18) return "Gold";
	if (p <= 0.4) return "Silver";
	if (p <= 0.8) return "Bronze";
	return "Copper";
}

class RankedUsersTestUpdater extends ProdDBBackUpdater {
	private aim7killCounts: Record<string, number> = {};

	public override loadEvents() {
		super.loadEvents();

		const os = this.kills.length;
		this.kills = this.kills.filter(k => k.killer.type == Aircraft.FA26b && k.victim.type == Aircraft.FA26b);
		console.log(`Filtered ${os - this.kills.length} kills.`);
	}

	// public override onUserUpdate(user: User, event: EloEvent, eloDelta: number) {
	// 	super.onUserUpdate(user, event, eloDelta);

	// 	switch (event.type) {
	// 		case "kill": {
	// 			const kill = event.event as Kill;
	// 			if (user.id != kill.killer.ownerId) return; // Only run logic once per kill
	// 			if (kill.weapon != Weapon.AIM7) return;
	// 			this.aim7killCounts[user.id] = (this.aim7killCounts[user.id] || 0) + 1;

	// 			// const killerSummaryAgainstVictim = this.getSummary(kill.killer.ownerId, kill.victim.ownerId);
	// 			// const victimSummaryAgainstKiller = this.getSummary(kill.victim.ownerId, kill.killer.ownerId);

	// 			// killerSummaryAgainstVictim.gain += eloDelta;
	// 			// victimSummaryAgainstKiller.loss += eloDelta;

	// 			break;
	// 		}
	// 	}
	// }

	public async log() {
		// const aim7killCounts = Object.entries(this.aim7killCounts).sort((a, b) => b[1] - a[1]);
		// const top = aim7killCounts.slice(0, 10);
		// for (const [id, count] of top) {
		// 	const u = this.usersMap[id];
		// 	console.log(`${u.pilotNames[0]} (${id}) ${count}`);
		// }
		// return;

		const rankedUsers = this.users.filter(u => userCanRank(u)).sort((a, b) => b.elo - a.elo);
		console.log(`There are ${rankedUsers.length} ranked users.`);

		const infos: Record<string, { minElo: number; maxElo: number; minPlace: number; maxPlace: number; total: number }> = {};

		let result = "";
		for (let i = 0; i < rankedUsers.length; i++) {
			const u = rankedUsers[i];
			// console.log(`${getUserRank(i + 1, rankedUsers.length)} ${u.elo.toFixed(0)} ${u.pilotNames[0]} (${u.id})`);
			const rank = getUserRank(i + 1, rankedUsers.length);

			const rankInfo = infos[rank] || { minElo: Infinity, maxElo: -Infinity, minPlace: Infinity, maxPlace: -Infinity, total: 0 };
			rankInfo.minElo = Math.min(rankInfo.minElo, u.elo);
			rankInfo.maxElo = Math.max(rankInfo.maxElo, u.elo);
			rankInfo.minPlace = Math.min(rankInfo.minPlace, i + 1);
			rankInfo.maxPlace = Math.max(rankInfo.maxPlace, i + 1);
			rankInfo.total++;
			infos[rank] = rankInfo;

			result += `${rank} ${u.elo.toFixed(0)} ${u.pilotNames[0]} (${u.id})\n`;
		}

		console.log(JSON.stringify(infos, null, 2));

		fs.writeFileSync("../../../rankedUsers.txt", result);
	}
}

// async function runAircraftUserUpdater() {
async function runRankedUsersTestUpdater() {
	const updater = new RankedUsersTestUpdater();
	await updater.runBackUpdate();
	await updater.log();
}

runRankedUsersTestUpdater();
