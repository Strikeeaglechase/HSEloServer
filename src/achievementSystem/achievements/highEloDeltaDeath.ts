import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const REQ_DELTA = 2300;
class HighEloDeltaDeathAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", async (kill: Kill) => {
			const killer = await this.manager.app.users.get(kill.killer.ownerId);
			const victim = await this.manager.app.users.get(kill.victim.ownerId);
			if (!killer || !victim) return;

			const delta = victim.elo - killer.elo;
			if (delta >= REQ_DELTA) this.giveToUser(kill.victim.ownerId);
		});
	}

	public static getId(): AchievementId {
		return "high_elo_delta_death";
	}
}

export default HighEloDeltaDeathAchievement;
