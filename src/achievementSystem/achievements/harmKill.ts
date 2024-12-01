import { Kill, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class HarmKillAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();
		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.weapon != Weapon.HARM) return;
			// Make sure user is moving
			const speed = Math.sqrt(kill.victim.velocity.x ** 2 + kill.victim.velocity.y ** 2 + kill.victim.velocity.z ** 2);
			if (speed < 25) return;

			this.giveToUser(kill.killer.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "harm_kill";
	}
}

export default HarmKillAchievement;
