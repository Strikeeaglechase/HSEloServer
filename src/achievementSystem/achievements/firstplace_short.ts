import { Achievement, AchievementId } from "../achievement.js";

const TIME_DIFF = 1000 * 60 * 5; // 5 minutes
class ShortTermFirstPlaceAchievement extends Achievement {
	private lastFirstPlace: string = null;
	private lastFirstPlaceTime: number = 0;

	public override async init(): Promise<void> {
		await super.init();
		await this.checkFirstPlace();
		setInterval(() => this.checkFirstPlace(), 1000 * 30); // 30 seconds
	}

	private async checkFirstPlace() {
		const firstPlaceUser = await this.manager.app.users.collection.findOne({ rank: 1 });
		if (!firstPlaceUser) return;

		if (!this.lastFirstPlace) {
			this.lastFirstPlace = firstPlaceUser.id;
			this.lastFirstPlaceTime = Date.now();
			return;
		}

		if (this.lastFirstPlace == firstPlaceUser.id) return;

		const timeDiff = Date.now() - this.lastFirstPlaceTime;
		if (timeDiff < TIME_DIFF) {
			this.giveToUser(firstPlaceUser.id);
			this.lastFirstPlace = firstPlaceUser.id;
			this.lastFirstPlaceTime = Date.now();
		}
	}

	public static getId(): AchievementId {
		return "firstplace_short";
	}
}

export default ShortTermFirstPlaceAchievement;
