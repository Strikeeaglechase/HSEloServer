import { Achievement, AchievementId } from "../achievement.js";

class OvertakeFirstAchievement extends Achievement {
	private lastFirstPlace: string = null;

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
			return;
		}

		if (this.lastFirstPlace == firstPlaceUser.id) return;

		this.giveToUser(firstPlaceUser.id);
		this.lastFirstPlace = firstPlaceUser.id;
	}

	public static getId(): AchievementId {
		return "overtake_first";
	}
}

export default OvertakeFirstAchievement;
