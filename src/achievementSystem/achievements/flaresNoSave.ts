import { isIRMissile, Kill, Tracking, User } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class FlaresNoSaveAchievement extends Achievement {
	private lastCmsTimes: Record<string, number[]> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (isIRMissile(kill.weapon)) {
				const cmsInLast15s = this.lastCmsTimes[kill.victim.ownerId]?.filter(time => Date.now() - time < 15000).length ?? 0;
				if (cmsInLast15s > 30) {
					this.giveToUser(kill.victim.ownerId);
				}
			}
		});

		this.manager.on("tracking_event", (tracking: Tracking) => {
			if (tracking.type == "cms") {
				if (!this.lastCmsTimes[tracking.args[0]]) this.lastCmsTimes[tracking.args[0]] = [];
				this.lastCmsTimes[tracking.args[0]].push(Date.now());
			}
		});

		this.manager.on("user_logout", (user: User) => {
			delete this.lastCmsTimes[user.id];
		});
	}

	public static getId(): AchievementId {
		return "flares_no_save";
	}
}

export default FlaresNoSaveAchievement;
