import { isIRMissile, Kill, Tracking } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class NoFlareHeaterAchievement extends Achievement {
	private lastCmsTimes: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (isIRMissile(kill.weapon)) {
				const cmsTime = this.lastCmsTimes[kill.victim.ownerId];
				if (!cmsTime || Date.now() - cmsTime > 15 * 1000) {
					this.giveToUser(kill.victim.ownerId);
				}
			}
		});

		this.manager.on("tracking_event", (tracking: Tracking) => {
			if (tracking.type == "cms") {
				this.lastCmsTimes[tracking.args[0]] = Date.now();
			}
		});
	}

	public static getId(): AchievementId {
		return "no_flare_heater";
	}
}

export default NoFlareHeaterAchievement;
