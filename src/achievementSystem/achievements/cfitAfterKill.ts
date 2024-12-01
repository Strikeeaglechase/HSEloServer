import { Kill, User, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const TIME_THRESH = 5000;
class CFITAfterKillAchievement extends Achievement {
	private userKillRecords: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			if (kill.killer.team == kill.victim.team) return;

			const now = Date.now();
			this.userKillRecords[kill.killer.ownerId] = now;

			if (kill.weapon == Weapon.CFIT) {
				// Check if the victim just got a kill
				if (this.userKillRecords[kill.victim.ownerId] && now - this.userKillRecords[kill.victim.ownerId] < TIME_THRESH) {
					this.giveToUser(kill.victim.ownerId);
				}
			}
		});

		this.manager.on("user_logout", async (user: User) => {
			if (this.userKillRecords[user.id]) delete this.userKillRecords[user.id];
		});
	}

	public static getId(): AchievementId {
		return "cfit_after_kill";
	}
}

export default CFITAfterKillAchievement;
