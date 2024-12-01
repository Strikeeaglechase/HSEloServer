import { Kill, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const MAX_RANGE = 926;
class MinRangeAIM120Achievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.weapon != Weapon.AIM120) return;

			// Calculate distance
			const distance = Math.sqrt(
				Math.pow(kill.victim.position.x - kill.killer.position.x, 2) +
					Math.pow(kill.victim.position.y - kill.killer.position.y, 2) +
					Math.pow(kill.victim.position.z - kill.killer.position.z, 2)
			);

			if (distance <= MAX_RANGE) this.giveToUser(kill.victim.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "minrange_aim120";
	}
}

export default MinRangeAIM120Achievement;
