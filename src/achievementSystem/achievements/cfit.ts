import { Kill, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class CFITAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.weapon == Weapon.CFIT) this.giveToUser(kill.victim.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "cfit";
	}
}

export default CFITAchievement;
