interface PartialKillInfo {
	serverInfo: {
		onlineUsers: string[];
	};
}

import fs from "fs";

import { User } from "../../structures.js";

const killData: PartialKillInfo[] = JSON.parse(fs.readFileSync("../../../vtol-server-elo.kills-v2.json", "utf-8"));
const top100Users: User[] = JSON.parse(fs.readFileSync("../../../vtol-server-elo.users.json", "utf-8"));

console.log(`Loaded ${killData.length} kill entries.`);
console.log(`Loaded ${top100Users.length} user entries.`);

const userOverlaps: Record<string, Record<string, number>> = {};

killData.forEach(killEntry => {
	killEntry.serverInfo.onlineUsers.forEach(userId => {
		killEntry.serverInfo.onlineUsers.forEach(otherUserId => {
			if (userId === otherUserId) return;

			if (!userOverlaps[userId]) userOverlaps[userId] = {};
			if (!userOverlaps[userId][otherUserId]) userOverlaps[userId][otherUserId] = 0;
			userOverlaps[userId][otherUserId]++;
		});
	});
});

const out = fs.createWriteStream("../../../out.txt");
const top100NonOverlaps: Record<string, string[]> = {};
top100Users.forEach(user => {
	const overlaps = userOverlaps[user.id];
	if (!overlaps) {
		console.log(`User ${user.pilotNames[0]} (${user.id}) has no overlaps with any other top 100 users.`);
		return;
	}

	top100Users.forEach(otherUser => {
		const overlapCount = overlaps[otherUser.id] || 0;

		if (overlapCount === 0) {
			if (!top100NonOverlaps[user.id]) top100NonOverlaps[user.id] = [];
			top100NonOverlaps[user.id].push(otherUser.id);
			// console.log(`User ${user.pilotNames[0]} (${user.id}) has no overlaps with ${otherUser.pilotNames[0]} (${otherUser.id}).`);
			// out.write(`User ${user.pilotNames[0]} (${user.id}) has no overlaps with ${otherUser.pilotNames[0]} (${otherUser.id}).\n`);

			// if (!userNonOverlapCounts[user.id]) userNonOverlapCounts[user.id] = 0;
			// userNonOverlapCounts[user.id]++;
		}
	});
});

for (const userId in top100NonOverlaps) {
	const user = top100Users.find(u => u.id == userId);

	out.write(`User ${user?.pilotNames[0]} (${userId}) has no overlaps with ${top100NonOverlaps[userId].length} top 100 users:\n`);
	top100NonOverlaps[userId].forEach(otherUserId => {
		const otherUser = top100Users.find(u => u.id == otherUserId);
		const otherUserNonCount = top100NonOverlaps[otherUserId]?.length || 0;
		out.write(`  - ${otherUser?.pilotNames[0]} (${otherUserId}) ${otherUserNonCount}\n`);
	});
}

out.end();
