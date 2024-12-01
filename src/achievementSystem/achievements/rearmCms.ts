import { Kill, Tracking, User } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class RefilCMSAchievement extends Achievement {
	private cmsCounts: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("tracking_event", (tracking: Tracking) => {
			if (tracking.type == "cms") {
				this.cmsCounts[tracking.args[0]] = (this.cmsCounts[tracking.args[0]] ?? 0) + 1;

				if (this.cmsCounts[tracking.args[0]] > 120) {
					this.giveToUser(tracking.args[0]);
				}
			}
		});

		this.manager.on("user_kill", (kill: Kill) => {
			delete this.cmsCounts[kill.victim.ownerId];
		});

		this.manager.on("user_logout", (user: User) => {
			delete this.cmsCounts[user.id];
		});
	}

	public static getId(): AchievementId {
		return "rearm_cms";
	}
}

export default RefilCMSAchievement;
