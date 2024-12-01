import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class OneEloKillAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill, deltaElo: number) => {
			if (deltaElo <= 1 && deltaElo > 0) {
				this.giveToUser(kill.killer.ownerId);
			}
		});
	}

	public static getId(): AchievementId {
		return "one_elo_kill";
	}
}

export default OneEloKillAchievement;
