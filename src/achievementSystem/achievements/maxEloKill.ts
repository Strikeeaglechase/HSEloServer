import { maxEloStealPoints } from "../../elo/eloUpdater.js";
import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class MaxEloKillAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill, deltaElo: number) => {
			if (deltaElo >= maxEloStealPoints) {
				this.giveToUser(kill.killer.ownerId);
			}
		});
	}

	public static getId(): AchievementId {
		return "max_elo_kill";
	}
}

export default MaxEloKillAchievement;
