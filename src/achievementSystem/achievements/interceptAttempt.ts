import { Tracking } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class InterceptAttemptAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("tracking_event", (event: Tracking) => {
			if (event.type == "intercept") this.giveToUser(event.args[2]);
		});
	}

	public static getId(): AchievementId {
		return "attempted_intercept";
	}
}

export default InterceptAttemptAchievement;
