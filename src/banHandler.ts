import { User } from "./structures.js";

const tkRatio = 2 / 10;
export function shouldUserBeBanned(user: User) {
	// Handle very low case
	if (user.kills < 5) return user.teamKills > 2;
	if (user.kills < 10) return user.teamKills > 3;

	const userTkRatio = user.teamKills / user.kills;
	if (userTkRatio > tkRatio) {
		console.log(`User ${user.id} has a team kill ratio of ${userTkRatio} and should be banned`);
	}
	return userTkRatio > tkRatio;
}