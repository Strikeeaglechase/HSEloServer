export enum Aircraft {
	AV42c,
	FA26b,
	F45A,
	AH94,
	Invalid,
	T55
}

export enum Weapon {
	Gun,
	AIM120,
	AIM9,
	AIM7,
	AIM9X,
	AIRST,
	HARM,
	Invalid,
	AIM9E,
	CFIT,
	Collision
}

export enum Team {
	Allied,
	Enemy,
	Invalid
}

export enum TimeOfDay {
	Morning,
	Day,
	Night,
	Invalid
}

export interface ScoreboardMessage {
	messageId: string;
	channelId: string;
	guildId: string;
	id: string;
}

export interface OnlineboardMessage {
	messageId: string;
	channelId: string;
	guildId: string;
	id: string;
}

export interface OnlineRole {
	roleId: string;
	guildId: string;
	id: string;
}

export interface User {
	id: string;
	pilotNames: string[];
	loginTimes: number[];
	logoutTimes: number[];
	kills: number;
	deaths: number;
	spawns: Record<Aircraft, number>;
	elo: number;
	eloHistory: { time: number, elo: number; }[];
	rank: number;
	history: string[];
	discordId: string;
	isBanned: boolean;
	teamKills: number;
	ignoreKillsAgainstUsers: string[];
	endOfSeasonStats: {
		season: number;
		rank: number;
		elo: number;
		teamKills: number;
		history: string;
	}[];
	eloFreeze: boolean;
}

export interface LimitedUserData {
	id: string;
	pilotNames: string[];
	kills: number;
	deaths: number;
	elo: number;
	rank?: number;
	discordId: string;
	isBanned: boolean;
	teamKills: number;
}

export function userToLimitedUser(user: User): LimitedUserData {
	return {
		id: user.id,
		pilotNames: user.pilotNames,
		kills: user.kills,
		deaths: user.deaths,
		elo: user.elo,
		rank: user.rank,
		discordId: user.discordId,
		isBanned: user.isBanned,
		teamKills: user.teamKills
	};
}


export function parseAircraftString(aircraft: string): Aircraft {
	if (!aircraft) return Aircraft.Invalid;

	const [_, name] = aircraft.split("/");
	switch (name) {
		case "VTOL4": return Aircraft.AV42c;
		case "FA-26B": return Aircraft.FA26b;
		case "SEVTF": return Aircraft.F45A;
		case "AH-94": return Aircraft.AH94;
		case "T-55": return Aircraft.T55;
		default: {
			console.error(`Unknown aircraft: ${aircraft}`);
			return Aircraft.Invalid;
		}
	}
}


export function parseWeaponString(weapon: string): Weapon {
	if (!weapon) return Weapon.Invalid;

	// Special weapons
	if (weapon === "GUN") return Weapon.Gun;
	if (weapon === "CFIT") return Weapon.CFIT;
	if (weapon === "COLLISION") return Weapon.Collision;

	const [_, __, name] = weapon.split("/");
	switch (name) {
		case "GUN": return Weapon.Gun;
		case "AIM-120":
		case "AIM-120D": return Weapon.AIM120;
		case "AIM-9": return Weapon.AIM9;
		case "AIM-7": return Weapon.AIM7;
		case "AIM-9+": return Weapon.AIM9X;
		case "AIRS-T": return Weapon.AIRST;
		case "HARM":
		case "SideARM": return Weapon.HARM;
		case "AIM-9E": return Weapon.AIM9E;
		default: {
			console.error(`Unknown weapon: ${weapon}`);
			return Weapon.Invalid;
		}
	}
}

export function isIRMissile(weapon: Weapon) {
	return [Weapon.AIM9E, Weapon.AIM9, Weapon.AIM9X, Weapon.AIRST].includes(weapon);
}

export function isActiveRadarMissile(weapon: Weapon) {
	return [Weapon.AIM120].includes(weapon);
}

export function isRadarMissile(weapon: Weapon) {
	return [Weapon.AIM120, Weapon.AIM7].includes(weapon);
}

export function parseTeamString(team: string): Team {
	switch (team) {
		case "Allied": return Team.Allied;
		case "Enemy": return Team.Enemy;
		default: {
			console.error(`Unknown team: ${team}`);
			return Team.Invalid;
		}
	}
}

export function parseTimeOfDayString(time: string): TimeOfDay {
	switch (time) {
		case "Morning": return TimeOfDay.Morning;
		case "Day": return TimeOfDay.Day;
		case "Night": return TimeOfDay.Night;
		default: {
			console.error(`Unknown time of day: ${time}`);
			return TimeOfDay.Invalid;
		}
	}
}

export interface KillOld {
	killerId: string;
	victimId: string;
	victimTeam: Team;
	killerTeam: Team;
	time: number;
	killerAircraft: Aircraft;
	victimAircraft: Aircraft;
	weapon: Weapon;
	id: string;

	killerPosition: { x: number, y: number, z: number; };
	victimPosition: { x: number, y: number, z: number; };

	killerVelocity: { x: number, y: number, z: number; };
	victimVelocity: { x: number, y: number, z: number; };
}

export function isKillOld(kill: any): kill is KillOld {
	return typeof kill.killerId == "string" &&
		typeof kill.victimId == "string" &&
		typeof kill.killerAircraft == "number" &&
		typeof kill.victimAircraft == "number" &&
		typeof kill.weapon == "number";
}


export interface UserAircraftInformation {
	ownerId: string;
	occupants: string[];
	position: { x: number, y: number, z: number; };
	velocity: { x: number, y: number, z: number; };
	team: Team;
	type: Aircraft;
}

export interface CurrentServerInformation {
	onlineUsers: string[];
	timeOfDay: TimeOfDay;
	missionId: string;
}

export interface Kill {
	killer: UserAircraftInformation;
	victim: UserAircraftInformation;
	serverInfo: CurrentServerInformation;

	weapon: Weapon;
	weaponUuid: string;
	previousDamagedByUserId: string;
	previousDamagedByWeapon: Weapon;

	time: number;
	id: string;
	season: number;
}

const aircraftLoadoutMap: Record<Aircraft, Weapon[]> = {
	[Aircraft.AV42c]: [],
	[Aircraft.FA26b]: [Weapon.Gun, Weapon.AIM120, Weapon.AIM9, Weapon.AIM7, Weapon.AIRST, Weapon.HARM, Weapon.AIM9E, Weapon.CFIT],
	[Aircraft.F45A]: [Weapon.Gun, Weapon.AIM120, Weapon.AIM9X, Weapon.CFIT],
	[Aircraft.AH94]: [],
	[Aircraft.Invalid]: [],
	[Aircraft.T55]: [Weapon.Gun, Weapon.AIM120, Weapon.AIM9, Weapon.AIM7, Weapon.AIRST, Weapon.HARM, Weapon.AIM9E, Weapon.CFIT],
};
export function isKillValid(kill: Kill) {
	if (kill.victim.type == Aircraft.Invalid) return false;
	if (kill.killer.type == Aircraft.Invalid) return false;
	if (kill.weapon == Weapon.Invalid) return false;
	const loadout = aircraftLoadoutMap[kill.killer.type];
	return loadout.includes(kill.weapon);
}

export interface Death {
	victim: UserAircraftInformation;
	serverInfo: CurrentServerInformation;

	time: number;
	killId?: string;
	id: string;
	season: number;
}

export interface DeathOld {
	victimId: string;
	time: number;
	victimAircraft: Aircraft;
	killId?: string;
	id: string;

	victimPosition: { x: number, y: number, z: number; };
	victimVelocity: { x: number, y: number, z: number; };
}


export function isDeath(death: any): death is DeathOld {
	return typeof death.victimId == "string" &&
		typeof death.victimAircraft == "number";
}

export interface Spawn {
	user: UserAircraftInformation;
	serverInfo: CurrentServerInformation;

	time: number;
	id: string;
	season: number;
}

export interface SpawnOld {
	userId: string;
	time: number;
	aircraft: Aircraft;
	id: string;
}

export function isSpawn(spawn: any): spawn is SpawnOld {
	return typeof spawn.userId == "string" &&
		typeof spawn.aircraft == "number";
}

export function logUser(user: User) {
	return `${user.pilotNames.length > 0 ? user.pilotNames[0] : "Unknown"} (${user.id})`;
}

export interface AllowedMod {
	name: string;
	id: string;
	hash: string;
}

export interface Season {
	name: string;
	id: number;
	started: string;
	ended: string;
	active: boolean;
	totalRankedUsers: number;
}

export interface Tracking {
	type: string;
	id: string;
	time: number;
	season: number;
	args: any[];
}

export interface MissileLaunchParams {
	uuid: string;
	type: Weapon;
	team: Team;
	launcher: UserAircraftInformation;
	players: UserAircraftInformation[];
}