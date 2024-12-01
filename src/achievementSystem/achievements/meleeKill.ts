import { Kill, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class MeleeKillAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.weapon == Weapon.Collision && kill.killer.team != kill.victim.team) this.giveToUser(kill.victim.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "melee_kill";
	}
}

export default MeleeKillAchievement;
