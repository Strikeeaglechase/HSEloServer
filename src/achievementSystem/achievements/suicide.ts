import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class SuicideAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.killer.ownerId == kill.victim.ownerId) this.giveToUser(kill.victim.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "self_tk";
	}
}

export default SuicideAchievement;
