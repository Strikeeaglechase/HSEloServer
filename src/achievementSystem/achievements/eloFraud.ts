import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class ELOFraudAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();
		this.manager.on("user_kill", (kill: Kill) => {
			// console.log({ prev: kill.previousDamagedByUserId, killer: kill.killer.ownerId });
			if (kill.previousDamagedByUserId == kill.killer.ownerId) {
				// const finalWeaponKillStr: KillString = `${Aircraft[kill.killer.type]}->${Weapon[kill.weapon]}->${Aircraft[kill.victim.type]}`;
				// const firstWeaponKillStr: KillString = `${Aircraft[kill.killer.type]}->${Weapon[kill.previousDamagedByWeapon]}->${Aircraft[kill.victim.type]}`;

				// const finalWeaponKillStr = getKillStr(kill);
				// const firstWeaponKillStr = getKillStr(kill, kill.previousDamagedByWeapon);

				const finalWeaponMult = this.manager.app.elo.getMultiplier(kill);
				const prevWeaponHypotheticalKill = { ...kill, weapon: kill.previousDamagedByWeapon };
				const firstWeaponMult = this.manager.app.elo.getMultiplier(prevWeaponHypotheticalKill);

				// console.log({
				// 	finalWeaponKillStr,
				// 	firstWeaponKillStr,

				// 	finalWeaponMult,
				// 	firstWeaponMult
				// });

				if (finalWeaponMult > firstWeaponMult) {
					this.giveToUser(kill.killer.ownerId);
				}
			}
		});
	}

	public static getId(): AchievementId {
		return "elo_fraud";
	}
}

export default ELOFraudAchievement;
