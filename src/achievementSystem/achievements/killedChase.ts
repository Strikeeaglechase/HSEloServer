import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const CHASE_USER_ID = "76561198162340088";
class KilledChaseAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			if (kill.killer.team != kill.victim.team && kill.victim.ownerId == CHASE_USER_ID) this.giveToUser(kill.killer.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "killed_chase";
	}
}

export default KilledChaseAchievement;
