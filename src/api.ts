import bodyParser from "body-parser";
import express from "express";
import Logger from "strike-discord-framework/dist/logger.js";
import { v4 as uuidv4 } from "uuid";

import { Application } from "./application.js";
import { createUserEloGraph } from "./graph/graph.js";
import {
	Aircraft, Death, Kill, logUser, parseAircraftString, parseTeamString, parseWeaponString, Spawn,
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


		this.registerRoute("POST", "users/:id/login", this.handleUserLogin, true);
		this.registerRoute("POST", "users/:id/logout", this.handleUserLogout, true);
		this.registerRoute("POST", "kills", this.handleKill, true);
		this.registerRoute("POST", "deaths", this.handleDeath, true);
		this.registerRoute("POST", "spawns", this.handleSpawn, true);
		this.registerRoute("POST", "online", this.updateOnlineUsers, true);
		this.registerRoute("GET", "mods", this.getAllowedMods, true);
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
			victimAircraft: string;
			killerAircraft: string;
			weapon: string;
			victimId: string;
			killerId: string;
			victimTeam: string;
			killerTeam: string;
			killerPosition: { x: number; y: number; z: number; };
			victimPosition: { x: number; y: number; z: number; };
			killerVelocity: { x: number; y: number; z: number; };
			victimVelocity: { x: number; y: number; z: number; };
		};
		const kill: Kill = {
			id: uuidv4(),
			time: Date.now(),
			victimAircraft: parseAircraftString(killReq.victimAircraft),
			killerAircraft: parseAircraftString(killReq.killerAircraft),
			weapon: parseWeaponString(killReq.weapon),
			victimId: killReq.victimId,
			killerId: killReq.killerId,
			victimTeam: parseTeamString(killReq.victimTeam),
			killerTeam: parseTeamString(killReq.killerTeam),
			killerPosition: { x: req.body.killerPosition.x, y: req.body.killerPosition.y, z: req.body.killerPosition.z },
			victimPosition: { x: req.body.victimPosition.x, y: req.body.victimPosition.y, z: req.body.victimPosition.z },
			killerVelocity: { x: req.body.killerVelocity.x, y: req.body.killerVelocity.y, z: req.body.killerVelocity.z },
			victimVelocity: { x: req.body.victimVelocity.x, y: req.body.victimVelocity.y, z: req.body.victimVelocity.z }
		};

		this.log.info(`Kill: ${kill.killerId} killed ${kill.victimId} with ${Weapon[kill.weapon]} in ${Aircraft[kill.killerAircraft]}`);

		// Create the death
		const death: Death = {
			id: uuidv4(),
			killId: kill.id,
			victimId: kill.victimId,
			victimAircraft: kill.victimAircraft,
			time: Date.now(),
			victimPosition: kill.victimPosition,
			victimVelocity: kill.victimVelocity,
		};
		this.app.kills.add(kill);
		this.app.deaths.add(death);

		const { killer, victim, eloSteal } = await this.app.elo.updateELOForKill(kill);
		// res.sendStatus(200);
		res.send({
			killerElo: killer.elo,
			victimElo: victim.elo,
			eloSteal: eloSteal
		});
	}

	private async handleDeath(req: express.Request, res: express.Response) {
		const deathReq = req.body as {
			victimId: string;
			victimAircraft: string;
			killerVelocity: { x: number; y: number; z: number; };
			victimVelocity: { x: number; y: number; z: number; };
		};
		const death: Death = {
			id: uuidv4(),
			time: Date.now(),
			victimId: deathReq.victimId,
			victimAircraft: parseAircraftString(deathReq.victimAircraft),
			victimPosition: { x: req.body.victimPosition.x, y: req.body.victimPosition.y, z: req.body.victimPosition.z },
			victimVelocity: { x: req.body.victimVelocity.x, y: req.body.victimVelocity.y, z: req.body.victimVelocity.z }
		};

		this.log.info(`Death: ${death.victimId} died in ${Weapon[death.victimAircraft]}`);

		this.app.deaths.add(death);
		this.app.elo.updateELOForDeath(death);

		res.sendStatus(200);
	}

	private async handleSpawn(req: express.Request, res: express.Response) {
		const spawnReq = req.body as { userId: string, aircraft: string; };
		const spawn: Spawn = {
			id: uuidv4(),
			time: Date.now(),
			userId: spawnReq.userId,
			aircraft: parseAircraftString(spawnReq.aircraft),
		};

		this.log.info(`Spawn: ${spawn.userId} spawned in ${Aircraft[spawn.aircraft]}`);
		this.app.spawns.add(spawn);

		const user = await this.app.users.get(spawn.userId);
		if (!user) return res.sendStatus(400);
		user.spawns[spawn.aircraft]++;
		await this.app.users.update(user, user.id);

		res.sendStatus(200);
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

	private registerRoute(verb: "GET" | "POST" | "PUT" | "DELETE", path: string, handler: (req: express.Request, res: express.Response) => unknown, auth: boolean = true) {
		const fullPath = ENDPOINT_BASE + (auth ? "private/" : "public/") + path;
		this.server[verb.toLowerCase()](fullPath, handler.bind(this));
		this.log.info(`Registered route (${verb}) ${fullPath}`);
	}
}

export { API };