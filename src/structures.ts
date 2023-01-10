export interface ScoreboardMessage {
	messageId: string;
	channelId: string;
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
	rank?: number;
	discordId: string;
}

export interface LimitedUserData {
	id: string;
	pilotNames: string[];
	kills: number;
	deaths: number;
	elo: number;
	rank?: number;
	discordId: string;
}

export function userToLimitedUser(user: User): LimitedUserData {
	return {
		id: user.id,
		pilotNames: user.pilotNames,
		kills: user.kills,
		deaths: user.deaths,
		elo: user.elo,
		rank: user.rank,
		discordId: user.discordId
	};
}

export enum Aircraft {
	AV42c,
	FA26b,
	F45A,
	AH94,
	Invalid
}

export function parseAircraftString(aircraft: string): Aircraft {
	const [_, name] = aircraft.split("/");
	switch (name) {
		case "VTOL4": return Aircraft.AV42c;
		case "FA-26B": return Aircraft.FA26b;
		case "SEVTF": return Aircraft.F45A;
		case "AH-94": return Aircraft.AH94;
		default: {
			console.error(`Unknown aircraft: ${aircraft}`);
			return Aircraft.Invalid;
		}
	}
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
	AIM9E
}

export function parseWeaponString(weapon: string): Weapon {
	if (weapon === "GUN") return Weapon.Gun;
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

export enum Team {
	Allied,
	Enemy,
	Invalid
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

export interface Kill {
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

export function isKill(kill: any): kill is Kill {
	return typeof kill.killerId == "string" &&
		typeof kill.victimId == "string" &&
		typeof kill.killerAircraft == "number" &&
		typeof kill.victimAircraft == "number" &&
		typeof kill.weapon == "number";
}

const aircraftLoadoutMap: Record<Aircraft, Weapon[]> = {
	[Aircraft.AV42c]: [],
	[Aircraft.FA26b]: [Weapon.Gun, Weapon.AIM120, Weapon.AIM9, Weapon.AIM7, Weapon.AIRST, Weapon.HARM, Weapon.AIM9E],
	[Aircraft.F45A]: [Weapon.Gun, Weapon.AIM120, Weapon.AIM9X],
	[Aircraft.AH94]: [],
	[Aircraft.Invalid]: []
};
export function isKillValid(kill: Kill) {
	if (kill.victimAircraft == Aircraft.Invalid) return false;
	if (kill.killerAircraft == Aircraft.Invalid) return false;
	if (kill.weapon == Weapon.Invalid) return false;
	const loadout = aircraftLoadoutMap[kill.killerAircraft];
	return loadout.includes(kill.weapon);
}

export interface Death {
	victimId: string;
	time: number;
	victimAircraft: Aircraft;
	killId?: string;
	id: string;

	victimPosition: { x: number, y: number, z: number; };
	victimVelocity: { x: number, y: number, z: number; };
}

export function isDeath(death: any): death is Death {
	return typeof death.victimId == "string" &&
		typeof death.victimAircraft == "number";
}

export interface Spawn {
	userId: string;
	time: number;
	aircraft: Aircraft;
	id: string;
}

export function isSpawn(spawn: any): spawn is Spawn {
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