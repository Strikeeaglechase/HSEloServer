import { User } from "discord.js";

import { Death, Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const REQ_TIME = 1000 * 5; // 5 seconds
class RageQuitAchievement extends Achievement {
	private deathTimes: Record<string, number> = {};
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			this.deathTimes[kill.victim.ownerId] = Date.now();
		});

		this.manager.on("user_death", (death: Death) => {
			this.deathTimes[death.victim.ownerId] = Date.now();
		});

		this.manager.on("user_logout", (user: User) => {
			if (!this.deathTimes[user.id]) return;
			if (Date.now() - this.deathTimes[user.id] < REQ_TIME) this.giveToUser(user.id);
		});
	}

	public static getId(): AchievementId {
		return "rage_quit";
	}
}

export default RageQuitAchievement;
