import { Kill, Weapon } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

class AIM7KillsAchievement extends Achievement {
	private aim7KillCounts: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			if (kill.weapon != Weapon.AIM7 || kill.killer.team == kill.victim.team) return;

			if (this.aim7KillCounts[kill.killer.ownerId] == undefined) {
				const aim7Kills = await this.manager.app.kills.collection
					.find({
						"killer.ownerId": kill.killer.ownerId,
						"weapon": Weapon.AIM7,
						"season": this.activeSeason.id
					})
					.toArray();
				this.aim7KillCounts[kill.killer.ownerId] = aim7Kills.length;
			}

			this.aim7KillCounts[kill.killer.ownerId]++;
			if (this.aim7KillCounts[kill.killer.ownerId] >= 15) this.giveToUser(kill.killer.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "15_aim7";
	}
}

export default AIM7KillsAchievement;
