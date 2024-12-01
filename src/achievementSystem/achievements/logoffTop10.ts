import { User } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const COWARD_PERIOD = 1000 * 60 * 3;
class LogoffTop10Achievement extends Achievement {
	private top10LoginTimes: Record<string, number> = {};

	public override async init(): Promise<void> {
		await super.init();
		this.manager.on("user_login", (u: User) => {
			if (u.rank <= 10) this.top10LoginTimes[u.id] = Date.now();
		});

		this.manager.on("user_logout", (u: User) => {
			if (u.rank > 10) return;

			Object.keys(this.top10LoginTimes).forEach(userId => {
				if (userId == u.id) return;

				const loginTime = this.top10LoginTimes[userId];
				const delta = Date.now() - loginTime;
				if (delta < COWARD_PERIOD) this.giveToUser(userId);
			});
		});
	}

	public static getId(): AchievementId {
		return "logoff_top10";
	}
}

export default LogoffTop10Achievement;
