import { Death, Kill, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class TWSAIM7 extends Achievement {
	private killTimes: Record<string, number[]> = {};
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.weapon != Weapon.AIM7) return;

			if (this.killTimes[kill.killer.ownerId] == undefined) this.killTimes[kill.killer.ownerId] = [];
			this.killTimes[kill.killer.ownerId].push(Date.now());
			this.killTimes[kill.killer.ownerId] = this.killTimes[kill.killer.ownerId].filter(time => Date.now() - time < 1000 * 15);
			if (this.killTimes[kill.killer.ownerId].length >= 2) this.giveToUser(kill.killer.ownerId);
		});

		this.manager.on("user_death", (death: Death) => {
			delete this.killTimes[death.victim.ownerId];
		});
	}

	public static getId(): AchievementId {
		return "tws_aim7";
	}
}

export default TWSAIM7;
