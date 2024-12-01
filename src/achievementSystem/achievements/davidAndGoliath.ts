import { Aircraft, Kill, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class DavidAndGoliathAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.killer.type == Aircraft.T55 && kill.victim.type == Aircraft.F45A && kill.weapon == Weapon.AIM9E) {
				this.giveToUser(kill.killer.ownerId);
			}
		});
	}

	public static getId(): AchievementId {
		return "david_and_goliath";
	}
}

export default DavidAndGoliathAchievement;
