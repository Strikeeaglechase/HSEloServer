import { Kill } from "../../structures.js";
import { Achievement, AchievementId } from "../achievement.js";

const bahaAccIds = ["76561197978114634", "76561199021972099", "76561198377211630"];
class KillBahaAchievement extends Achievement {
	public override async init(): Promise<void> {
		await super.init();

		this.manager.on("user_kill", (kill: Kill) => {
			if (kill.killer.team != kill.victim.team && bahaAccIds.some(acId => kill.victim.ownerId == acId)) {
				this.giveToUser(kill.killer.ownerId);
			}
		});
	}

	public static getId(): AchievementId {
		return "kill_baha";
	}
}

export default KillBahaAchievement;
