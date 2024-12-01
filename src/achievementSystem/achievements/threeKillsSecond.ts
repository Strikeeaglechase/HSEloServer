import { Kill, User } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const KILLS_REQ = 3;
const TIME_THRESH = 1000;
class WellTimedAchievement extends Achievement {
	private userKillRecords: Record<string, number[]> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			if (kill.killer.team == kill.victim.team) return;

			if (!this.userKillRecords[kill.killer.ownerId]) this.userKillRecords[kill.killer.ownerId] = [];
			const now = Date.now();
			this.userKillRecords[kill.killer.ownerId].push(now);
			this.userKillRecords[kill.killer.ownerId] = this.userKillRecords[kill.killer.ownerId].filter(time => now - time < TIME_THRESH);

			if (this.userKillRecords[kill.killer.ownerId].length >= KILLS_REQ) {
				this.giveToUser(kill.killer.ownerId);
				delete this.userKillRecords[kill.killer.ownerId];
			}
		});

		this.manager.on("user_logout", async (user: User) => {
			if (this.userKillRecords[user.id]) delete this.userKillRecords[user.id];
		});
	}

	public static getId(): AchievementId {
		return "three_kill_sec";
	}
}

export default WellTimedAchievement;
