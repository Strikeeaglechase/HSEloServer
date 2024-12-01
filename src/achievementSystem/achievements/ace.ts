import { Death, Kill, User } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const KILLS_REQ = 5;
class ACEAchievement extends Achievement {
	private userKillRecords: Record<string, string[]> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			if (kill.killer.team == kill.victim.team) return;

			if (!this.userKillRecords[kill.killer.ownerId]) this.userKillRecords[kill.killer.ownerId] = [];
			this.userKillRecords[kill.killer.ownerId].push(kill.victim.ownerId);

			if (this.userKillRecords[kill.victim.ownerId]) delete this.userKillRecords[kill.victim.ownerId];

			if (this.userKillRecords[kill.killer.ownerId].length >= KILLS_REQ) {
				this.giveToUser(kill.killer.ownerId);
				delete this.userKillRecords[kill.killer.ownerId];
			}
		});

		this.manager.on("user_death", async (death: Death) => {
			if (this.userKillRecords[death.victim.ownerId]) delete this.userKillRecords[death.victim.ownerId];
		});

		this.manager.on("user_logout", async (user: User) => {
			if (this.userKillRecords[user.id]) delete this.userKillRecords[user.id];
		});
	}

	public static getId(): AchievementId {
		return "ace";
	}
}

export default ACEAchievement;
