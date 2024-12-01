import { Death, MissileLaunchParams, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class MaxMalds extends Achievement {
	private maldsShot: Record<string, number> = {};
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("missile_launch_params", (mlps: MissileLaunchParams) => {
			if (mlps.type != Weapon.MALD) return;
			if (this.maldsShot[mlps.launcher.ownerId] == undefined) this.maldsShot[mlps.launcher.ownerId] = 0;
			this.maldsShot[mlps.launcher.ownerId]++;

			if (this.maldsShot[mlps.launcher.ownerId] >= 6) {
				this.giveToUser(mlps.launcher.ownerId);
				this.maldsShot[mlps.launcher.ownerId] = 0;
			}
		});

		this.manager.on("user_death", (death: Death) => {
			delete this.maldsShot[death.victim.ownerId];
		});
	}

	public static getId(): AchievementId {
		return "max_malds";
	}
}

export default MaxMalds;
