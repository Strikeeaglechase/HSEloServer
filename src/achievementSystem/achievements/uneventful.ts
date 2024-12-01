import { Achievement, AchievementId } from "../achievement.js";

// TODO
class UneventfulAchievement extends Achievement {
	private userSpawnTimes: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();
	}

	public static getId(): AchievementId {
		return "uneventful";
	}
}

export default UneventfulAchievement;
