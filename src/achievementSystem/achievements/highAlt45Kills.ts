import { Aircraft, Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const REQ_ALT = 10668;
const REQ_HIGH_ALT_KILLS = 20;
class HighAlt45KillsAchievement extends Achievement {
	private highAltKillCounts: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			if (kill.killer.type != Aircraft.F45A || kill.killer.position.y < REQ_ALT) return;

			if (this.highAltKillCounts[kill.killer.ownerId] == undefined) {
				const highAltKills = await this.manager.app.kills.collection
					.find({
						"killer.ownerId": kill.killer.ownerId,
						"killer.type": Aircraft.F45A,
						"killer.position.y": { $gte: REQ_ALT },
						"season": this.activeSeason.id
					})
					.toArray();
				this.highAltKillCounts[kill.killer.ownerId] = highAltKills.length;
			}

			this.highAltKillCounts[kill.killer.ownerId]++;
			if (this.highAltKillCounts[kill.killer.ownerId] >= REQ_HIGH_ALT_KILLS) this.giveToUser(kill.killer.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "high_alt_45_kills";
	}
}

export default HighAlt45KillsAchievement;
