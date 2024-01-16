import { EventEmitter } from "./eventEmitter.js";
import { Death, Kill, MissileLaunchParams, Tracking, User } from "./structures.js";

type AchievementId = string;

interface IAchievement {
	id: AchievementId;
	name: string;
	description: string;
}

interface IAchievementManager extends EventEmitter {
	init(): Promise<void>;
	getAchievement(id: string): IAchievement;
	onKill(kill: Kill, deltaElo: number): void;
	onDeath(death: Death, deltaElo: number): void;
	onTrackingEvent(tracking: Tracking): void;
	onUserLogin(user: User): void;
	onUserLogout(user: User): void;
	onLinkedAccount(user: User): void;
	onMissileLaunchParams(params: MissileLaunchParams): void;
}

class DummyAchievementManager extends EventEmitter implements IAchievementManager {
	getAchievement(id: string): IAchievement {
		return null;
	}
	async init() {}
	onKill(kill: Kill) {}
	onDeath(death: Death) {}
	onTrackingEvent(tracking: Tracking) {}
	onUserLogin(user: User) {}
	onUserLogout(user: User) {}
	onLinkedAccount(user: User) {}
	onMissileLaunchParams(params: MissileLaunchParams) {}
}

export { IAchievement, IAchievementManager, DummyAchievementManager, AchievementId };
