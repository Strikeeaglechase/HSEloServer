import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class TeamSwitchSelfKillAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			if (kill.killer.ownerId == kill.victim.ownerId) {
				const launchParams = await this.manager.app.missileLaunchParams.get(kill.weaponUuid);
				if (!launchParams) return;

				if (launchParams.team != kill.victim.team) {
					this.giveToUser(kill.killer.ownerId);
				}
			}
		});
	}

	public static getId(): AchievementId {
		return "self_kill";
	}
}

export default TeamSwitchSelfKillAchievement;
