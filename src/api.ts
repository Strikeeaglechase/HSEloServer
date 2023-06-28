import bodyParser from "body-parser";
import express from "express";
import fs from "fs";
import path from "path";
import Logger from "strike-discord-framework/dist/logger.js";
import { v4 as uuidv4 } from "uuid";

import { Application } from "./application.js";
import { createUserEloGraph } from "./graph/graph.js";
import {
	Aircraft, CurrentServerInformation, Death, Kill, logUser, parseAircraftString, parseTeamString,
	parseTimeOfDayString, parseWeaponString, Spawn, Tracking, UserAircraftInformation,
	userToLimitedUser, Weapon
} from "./structures.js";

export const ENDPOINT_BASE = "/api/v1/";
export function getHost() {
	// return process.env.IS_DEV == "true" ? `` : `https://hs.vtolvr.live`;
	return "https://hs.vtolvr.live";
}
const nums = "0123456789";
const isNum = (str: string) => str.split("").every(c => nums.includes(c)) && str.length < 5;
function parseValue(str: string) {
	if (str == "true") return true;
	if (str == "false") return false;
	if (isNum(str)) return parseInt(str);
	return str;
}

function parseQuery(query: any, allowedQueries: string[]) {
	const result: Record<any, any> = {};
	for (const key in query) {
		if (!allowedQueries.includes(key)) continue;
		if (query[key].includes("$")) continue;

		result[key] = parseValue(query[key]);
	}
	return result;
}

interface APIUserAircraft {
	ownerId: string;
	occupants: string[];
	position: { x: number, y: number, z: number; };
	velocity: { x: number, y: number, z: number; };
	team: string;
	type: string;
}

interface APIServerInfo {
	onlineUsers: string[];
	timeOfDay: string;
	missionId: string;
}

function parseAPIUserAircraft(apiUA: APIUserAircraft): UserAircraftInformation {
	return {
		ownerId: apiUA.ownerId,
		occupants: apiUA.occupants,
		position: apiUA.position,
		velocity: apiUA.velocity,
		team: parseTeamString(apiUA.team),
		type: parseAircraftString(apiUA.type)
	};
}

function parseAPIServerInfo(apiSI: APIServerInfo): CurrentServerInformation {
	return {
		onlineUsers: apiSI.onlineUsers,
		timeOfDay: parseTimeOfDayString(apiSI.timeOfDay),
		missionId: apiSI.missionId
	};
}

class API {
	private server: express.Express = express();
	private log: Logger;

	constructor(private app: Application) {
		this.log = app.log;
	}

	public async init() {
		const port = parseInt(process.env.PORT);

		this.server.use(bodyParser.json());
		this.server.use((req, res, next) => {
			this.log.info(`(${req.method}) ${req.path}  ${JSON.stringify(req.query)}  ${JSON.stringify(req.body)}`);
			if (!req.path.startsWith(ENDPOINT_BASE)) return res.sendStatus(404);
			if (req.path.startsWith(ENDPOINT_BASE + "public/")) return next();
			if (req.headers.authorization !== process.env.AUTH_TOKEN) {
				this.log.info(` - Invalid auth token: ${req.headers.authorization}`);
				res.status(403);
				return;
			}
			next();
		});

		this.registerRoute("GET", "users", this.getUserStats, false);
		this.registerRoute("GET", "users/:id", this.getUser, false);
		this.registerRoute("GET", "kills", this.getKills, false);
		this.registerRoute("GET", "deaths", this.getDeaths, false);
		this.registerRoute("GET", "online", this.getOnlineUsers, false);
		this.registerRoute("GET", "graph/:id", this.getUserGraph, false);
		this.registerRoute("GET", "graph/:id/:refreshId", this.getUserGraph, false);
		this.registerRoute("GET", "log/:id", this.getUserLog, false);
		this.registerRoute("GET", "multipliers", this.getMultipliers, false);
		this.registerRoute("GET", "blocklist", this.getBlockList, false);
		this.registerRoute("GET", "bannedUsers", this.getBannedUsers, false);


		this.registerRoute("POST", "users/:id/login", this.handleUserLogin, true);
		this.registerRoute("POST", "users/:id/logout", this.handleUserLogout, true);
		this.registerRoute("POST", "kills", this.handleKill, true);
		this.registerRoute("POST", "deaths", this.handleDeath, true);
		this.registerRoute("POST", "spawns", this.handleSpawn, true);
		this.registerRoute("POST", "online", this.updateOnlineUsers, true);
		this.registerRoute("POST", "tracking", this.handleTracking, true);
		this.registerRoute("GET", "mods", this.getAllowedMods, true);
		this.registerRoute("GET", "liveryUpdate", this.handleLiveryUpdate, true);

		// this.registerRoute("GET", "")



		this.server.listen(port, () => {
			this.log.info(`ELO API listening on port ${port}`);
		});
	}

	private async getUserStats(req: express.Request, res: express.Response) {
		const users = await this.app.updateSortedUsers();

		res.send(users.map(u => userToLimitedUser(u)));
	}

	private async getUser(req: express.Request, res: express.Response) {
		let user = await this.app.users.get(req.params.id);
		if (!user) {
			user = await this.app.createNewUser(req.params.id);
		}
		this.app.cachedSortedUsers.forEach((u, idx) => {
			if (user.id == u.id) user.rank = idx + 1;
		});
		if (user.rank == undefined) user.rank = 0;
		res.send(user);
	}

	private async getKills(req: express.Request, res: express.Response) {
		const allowedQueries = ["id", "victimId", "killerId", "killerTeam", "victimTeam", "weapon", "killerAircraft", "victimAircraft"];
		const dbQuery = parseQuery(req.query, allowedQueries);
		const kills = await this.app.kills.collection.find(dbQuery).toArray();
		res.send(kills);
	}

	private async getDeaths(req: express.Request, res: express.Response) {
		const allowedQueries = ["id", "victimId", "victimAircraft", "killId"];
		const dbQuery = parseQuery(req.query, allowedQueries);
		const deaths = await this.app.deaths.collection.find(dbQuery).toArray();
		res.send(deaths);
	}

	private async getUserGraph(req: express.Request, res: express.Response) {
		const user = await this.app.users.get(req.params.id);
		if (!user) return res.sendStatus(404);

		const path = await createUserEloGraph(user);
		res.sendFile(path);
	}

	private async getUserLog(req: express.Request, res: express.Response) {
		const id = req.params.id;
		const log = await this.app.elo.getUserLogText(id, await this.app.getActiveSeason());
		res.send(log);
	}

	private async getMultipliers(req: express.Request, res: express.Response) {
		res.send(this.app.elo.lastMultipliers);
	}

	private async handleUserLogin(req: express.Request, res: express.Response) {
		if (!req.params.id) return res.sendStatus(400);

		let user = await this.app.users.get(req.params.id);
		if (!user) user = await this.app.createNewUser(req.params.id);

		if (user.pilotNames.length == 0 || user.pilotNames[0] != req.body.pilotName) {
			this.log.info(`New pilot name for user ${logUser(user)}: ${req.body.pilotName}`);
			// user.pilotNames.unshift(req.body.pilotName);
			// Preform unshift
			await this.app.users.collection.updateOne({ id: user.id },
				{
					$push: {
						pilotNames: {
							$each: [req.body.pilotName],
							$position: 0
						}
					}
				});
		}

		this.log.info(`User ${logUser(user)} logged in`);
		await this.app.users.collection.updateOne({ id: user.id }, { $push: { loginTimes: Date.now() } });
		// await this.app.users.update(user, user.id);
		res.sendStatus(200);
	}

	private async handleUserLogout(req: express.Request, res: express.Response) {
		if (!req.params.id) return res.sendStatus(400);

		let user = await this.app.users.get(req.params.id);
		if (!user) user = await this.app.createNewUser(req.params.id);

		this.log.info(`User ${logUser(user)} logged out`);
		user.logoutTimes.push(Date.now());
		await this.app.users.update(user, user.id);
		res.sendStatus(200);
	}

	private async handleKill(req: express.Request, res: express.Response) {
		const killReq = req.body as {
			victim: APIUserAircraft,
			killer: APIUserAircraft,
			weapon: string,
			serverInfo: APIServerInfo,
		};
		const kill: Kill = {
			id: uuidv4(),
			time: Date.now(),
			weapon: parseWeaponString(killReq.weapon),
			killer: parseAPIUserAircraft(killReq.killer),
			victim: parseAPIUserAircraft(killReq.victim),
			serverInfo: parseAPIServerInfo(killReq.serverInfo),
			season: this.app.elo.activeSeason.id,
		};

		this.log.info(`Kill: ${kill.killer.ownerId} killed ${kill.victim.ownerId} with ${Weapon[kill.weapon]} in ${Aircraft[kill.killer.type]}`);

		// Create the death
		const death: Death = {
			id: uuidv4(),
			killId: kill.id,
			time: Date.now(),
			victim: kill.victim,
			serverInfo: kill.serverInfo,
			season: this.app.elo.activeSeason.id,
		};
		this.app.kills.add(kill);
		this.app.deaths.add(death);

		const update = await this.app.elo.updateELOForKill(kill);
		if (!update) {
			res.send({
				killerElo: 0,
				victimElo: 0,
				eloSteal: 0
			});
			return;
		}

		const { killer, victim, eloSteal } = update;
		// res.sendStatus(200);
		res.send({
			killerElo: killer.elo,
			victimElo: victim.elo,
			eloSteal: eloSteal
		});
	}

	private async handleDeath(req: express.Request, res: express.Response) {
		const deathReq = req.body as {
			victim: APIUserAircraft,
			serverInfo: APIServerInfo,
		};
		const death: Death = {
			id: uuidv4(),
			time: Date.now(),
			victim: parseAPIUserAircraft(deathReq.victim),
			serverInfo: parseAPIServerInfo(deathReq.serverInfo),
			season: this.app.elo.activeSeason.id,
		};

		this.log.info(`Death: ${death.victim.ownerId} died in ${Weapon[death.victim.type]}`);

		this.app.deaths.add(death);
		this.app.elo.updateELOForDeath(death);

		res.sendStatus(200);
	}

	private async handleSpawn(req: express.Request, res: express.Response) {
		const spawnReq = req.body as { user: APIUserAircraft, serverInfo: APIServerInfo; };
		// console.log(req.body);
		// console.log(typeof req.body);
		const spawn: Spawn = {
			id: uuidv4(),
			time: Date.now(),
			user: parseAPIUserAircraft(spawnReq.user),
			serverInfo: parseAPIServerInfo(spawnReq.serverInfo),
			season: this.app.elo.activeSeason.id,
		};

		this.log.info(`Spawn: ${spawn.user.ownerId} spawned in ${Aircraft[spawn.user.type]}`);
		this.app.spawns.add(spawn);

		const user = await this.app.users.get(spawn.user.ownerId);
		if (!user) return res.sendStatus(400);
		if (!user.spawns) user.spawns = {
			[Aircraft.AV42c]: 0,
			[Aircraft.FA26b]: 0,
			[Aircraft.AH94]: 0,
			[Aircraft.T55]: 0,
			[Aircraft.F45A]: 0,
			[Aircraft.Invalid]: 0,
		};
		if (!user.spawns[spawn.user.type]) user.spawns[spawn.user.type] = 0;
		user.spawns[spawn.user.type]++;
		await this.app.users.collection.updateOne({ id: user.id }, { $set: { spawns: user.spawns } });

		res.sendStatus(200);
	}

	private async handleTracking(req: express.Request, res: express.Response) {
		const type = req.query.type as string;
		const args = req.body as any[];
		this.log.info(`Tracking: ${type} ${args.join(', ')}`);

		const trackingObject: Tracking = {
			id: uuidv4(),
			time: Date.now(),
			type: type,
			args: args,
			season: this.app.elo.activeSeason.id,
		};
		await this.app.tracking.add(trackingObject);

		res.sendStatus(200);
	}

	private async handleLiveryUpdate(req: express.Request, res: express.Response) {
		const userId = req.query.userId as string;
		const aircraft = req.query.aircraft as string;
		const liveryId = req.query.liveryId as string;

		const user = await this.app.users.get(userId);
		if (!user) return res.sendStatus(200);
		if (user.kills < 10) return res.sendStatus(200);

		this.log.info(`Livery Update: ${user.id} updated their ${aircraft} livery to ${liveryId}`);
		const id = await this.app.liveryUpdater.addTask(user, parseAircraftString(aircraft), liveryId, user.kills);
		this.log.info(`Got livery ${id} for ${user.id}`);
		res.send(id);
	}

	private async getAllowedMods(req: express.Request, res: express.Response) {
		res.send(await this.app.allowedMods.get());
	}

	private async updateOnlineUsers(req: express.Request, res: express.Response) {
		this.app.onlineUsers = req.body;
		res.sendStatus(200);
	}

	private async getOnlineUsers(req: express.Request, res: express.Response) {
		res.send(this.app.onlineUsers);
	}

	private async getBlockList(req: express.Request, res: express.Response) {
		// https://hs.vtolvr.live/api/v1/public/users
		const bannedUsers = await this.app.users.collection.find({ isBanned: true }).toArray();
		// const bannedUsers = users.filter(u => u.isBanned);

		let text = `NODE\n{`;
		bannedUsers.forEach(user => {
			text += `\n    USER\n    {\n`;
			text += `        id = ${user.id}\n`;
			text += `        steamName = ${user.pilotNames[0]}\n`;
			text += `        pilotName = ${user.pilotNames[0]}\n`;
			text += `    }\n`;
		});

		text += `\n}`;

		fs.writeFileSync("../banlist.txt", text);

		// res.send(text);
		res.sendFile(path.resolve("../banlist.txt"));
	}

	private async getBannedUsers(req: express.Request, res: express.Response) {
		const bannedUsers = await this.app.users.collection.find({ isBanned: true }).toArray();
		res.send(bannedUsers);
	}

	private registerRoute(verb: "GET" | "POST" | "PUT" | "DELETE", path: string, handler: (req: express.Request, res: express.Response) => unknown, auth: boolean = true) {
		const fullPath = ENDPOINT_BASE + (auth ? "private/" : "public/") + path;
		this.server[verb.toLowerCase()](fullPath, handler.bind(this));
		this.log.info(`Registered route (${verb}) ${fullPath}`);
	}
}

export { API };