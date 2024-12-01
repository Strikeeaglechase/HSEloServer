import { User } from "discord.js";

import { Achievement, AchievementId } from "../achievement.js";

class LinkedAccountAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("linked_account", (user: User) => {
			this.giveToUser(user.id);
		});
	}

	public static getId(): AchievementId {
		return "linked_account";
	}
}

export default LinkedAccountAchievement;
