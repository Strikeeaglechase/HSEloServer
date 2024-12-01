import { Aircraft, Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class PayToWinAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.killer.type == Aircraft.T55 || kill.killer.type == Aircraft.EF24G) this.giveToUser(kill.killer.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "pay_to_win";
	}
}

export default PayToWinAchievement;
