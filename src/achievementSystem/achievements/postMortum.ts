import { Kill, User, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class PostMortumAchievement extends Achievement {
	private deathTimes: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			this.deathTimes[kill.victim.ownerId] = Date.now();

			if (kill.weapon == Weapon.AIM7 && Date.now() - this.deathTimes[kill.killer.ownerId] < 15000) {
				this.giveToUser(kill.killer.ownerId);
			}
		});

		this.manager.on("user_logout", (user: User) => {
			delete this.deathTimes[user.id];
		});
	}

	public static getId(): AchievementId {
		return "post_mortum";
	}
}

export default PostMortumAchievement;
