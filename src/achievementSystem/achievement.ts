import fs from "fs";
import Logger from "strike-discord-framework/dist/logger.js";

import { IAchievement } from "../achievementDeclare.js";
import { Season, Tracking } from "../structures.js";
import { AchievementManager } from "./achievementManager.js";

type AchievementId =
	| "harm_kill"
	| "cfit"
	| "melee_kill"
	| "elo_fraud"
	| "killsteal_guns"
	| "spawncamp"
	| "damaged_restart"
	| "firstplace_short"
	| "overtake_first"
	| "bad_pk"
	| "attempted_intercept"
	| "15_aim7"
	| "logoff_top10"
	| "wrong_way"
	| "killed_chase"
	| "high_alt_45_kills"
	| "max_elo_kill"
	| "one_elo_kill"
	| "max_elo_death"
	| "high_elo_delta_death"
	| "no_flare_heater"
	| "minrange_aim120"
	| "secret_base"
	| "linked_account"
	| "rage_quit"
	| "combat_log"
	| "tk_baha"
	| "kill_baha"
	| "ace"
	| "three_kill_sec"
	| "reach_70k"
	| "die_on_airfield"
	| "runway_takeoff"
	| "cfit_after_kill"
	| "long_range_ir"
	| "self_tk"
	| "self_kill"
	| "pay_to_win"
	| "long_range"
	| "land_enemy_base"
	| "super_secret_base"
	| "fooled"
	| "spammer"
	| "tws_aim7"
	| "max_malds"
	| "rude"
	| "david_and_goliath"
	| "flares_no_save"
	| "out_of_cms"
	| "rearm_cms"
	| "high_alt_120"
	| "post_mortum"
	| "uneventful"
	| "poor_planning";
type AchievementCondition = "many_ranked_users" | "many_missiles_shot";

interface AchievementDef {
	id: AchievementId;
	name: AchievementCondition;
	description: string;
	condition: string;
	enabled: boolean;
	max: number;
}

const REQ_RANKED_USERS = 50;

type AchievementCtor<T extends Achievement> = (new (def: AchievementDef, manager: AchievementManager) => T) & { getId: () => AchievementId };

class Achievement implements AchievementDef, IAchievement {
	public id: AchievementId;
	public name: AchievementCondition;
	public description: string;
	public condition: AchievementCondition;
	public enabled: boolean;
	public max: number;

	protected log: Logger;
	protected activeSeason: Season;

	static achievementTypes: AchievementCtor<Achievement>[] = [];

	constructor(def: AchievementDef, protected manager: AchievementManager) {
		Object.assign(this, def);
		this.log = manager.log;

		this.log.info(`Loaded achievement: ${this}`);
	}

	public async init() {
		this.activeSeason = await this.manager.app.getActiveSeason();

		this.manager.on("tracking_event", (event: Tracking) => {
			if (event.type == "achievement_grant") {
				const [achievementId, userId] = event.args;
				if (achievementId == this.id) {
					this.giveToUser(userId);
				}
			}
		});
	}

	public async giveToUser(userId: string) {
		const { canGet, reason } = this.canGetAchievement();
		if (!canGet) {
			this.log.info(`Attempted to give ${this} to user ${userId} but ${reason}`);
			return;
		}

		// this.log.info(`----------- Giving ${this} to user ${userId} -----------`);
		const userCol = this.manager.app.users.collection;
		const user = await userCol.findOne({ id: userId });

		if (!user.achievements) user.achievements = [];

		this.log.info(`Giving ${this} to user ${userId}`);
		this.manager.onAchievementGiven(user, this);
	}

	private canGetAchievement(): { canGet: boolean; reason?: string } {
		if (!this.enabled) return { canGet: false, reason: "Achievement is disabled" };
		if (!this.isConditionMet()) return { canGet: false, reason: "Achievement condition not met" };
		return { canGet: true };
	}

	private isConditionMet() {
		if (!this.condition) return true;
		switch (this.condition) {
			case "many_ranked_users":
				return this.activeSeason.totalRankedUsers >= REQ_RANKED_USERS;

			default:
				this.log.error(`Unknown achievement condition: ${this.condition}`);
				return true;
		}
	}

	static async loadAchievementClasses(log: Logger) {
		const achievementPath = "./achievementSystem/achievements/";
		const files = fs.readdirSync(achievementPath);
		for (const file of files) {
			if (!file.endsWith(".js")) continue;
			log.info(`Loading achievement ${file}`);
			const achievement = await import(`./achievements/${file}`);
			const existing = this.achievementTypes.find(ctor => ctor.getId() == achievement.default.getId());
			if (existing) {
				log.error(`Duplicate achievement id: ${existing.getId()}`);
				continue;
			}
			this.achievementTypes.push(achievement.default);
		}
	}

	static async create(def: AchievementDef, manager: AchievementManager): Promise<Achievement> {
		const ctor = this.achievementTypes.find(ctor => ctor.getId() == def.id);
		if (!ctor) {
			manager.log.info(`Failed to find achievement type for ${def.id}`);
			const ach = new Achievement(def, manager);
			await ach.init();

			return ach;
		}

		const ach = new ctor(def, manager);
		await ach.init();

		return ach;
	}

	static getId(): AchievementId {
		throw new Error(`GetID called on abstract achievement`);
	}

	public toString() {
		return `${this.id}`;
	}
}

export { Achievement, AchievementDef, AchievementId, AchievementCondition };
