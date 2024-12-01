import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const REQ_DIST = 111120;
class LongRangeKillAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			const launchParams = await this.manager.app.missileLaunchParams.get(kill.weaponUuid);
			if (!launchParams) return;

			const launcherPos = launchParams.launcher.position;
			const victimPos = launchParams.players.find(p => p.ownerId == kill.victim.ownerId)?.position;
			if (!victimPos) return;

			const distance = Math.sqrt(
				Math.pow(launcherPos.x - victimPos.x, 2) + Math.pow(launcherPos.y - victimPos.y, 2) + Math.pow(launcherPos.z - victimPos.z, 2)
			);

			if (distance < REQ_DIST) return;

			this.giveToUser(kill.killer.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "long_range";
	}
}

export default LongRangeKillAchievement;
