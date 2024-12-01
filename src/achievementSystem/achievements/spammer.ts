import { Death, MissileLaunchParams } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class Spammer extends Achievement {
	private missileShotTimes: Record<string, number[]> = {};
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("missile_launch_params", (mlps: MissileLaunchParams) => {
			if (this.missileShotTimes[mlps.launcher.ownerId] == undefined) this.missileShotTimes[mlps.launcher.ownerId] = [];
			this.missileShotTimes[mlps.launcher.ownerId].push(Date.now());
			this.missileShotTimes[mlps.launcher.ownerId] = this.missileShotTimes[mlps.launcher.ownerId].filter(time => Date.now() - time < 1000 * 10);
			if (this.missileShotTimes[mlps.launcher.ownerId].length >= 10) {
				this.giveToUser(mlps.launcher.ownerId);
				this.missileShotTimes[mlps.launcher.ownerId] = [];
			}
		});

		this.manager.on("user_death", (death: Death) => {
			delete this.missileShotTimes[death.victim.ownerId];
		});
	}

	public static getId(): AchievementId {
		return "spammer";
	}
}

export default Spammer;
