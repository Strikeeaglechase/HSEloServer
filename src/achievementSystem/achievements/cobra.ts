import { Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class CobraAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", kill => {
			if (kill.weapon == Weapon.Gun && kill.killer.aoa > 90) {
				this.giveToUser(kill.killer.ownerId);
			}
		});
	}

	public static getId(): AchievementId {
		return "cobra";
	}
}

export default CobraAchievement;
