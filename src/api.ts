import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import Logger from "strike-discord-framework/dist/logger.js";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { Application, IAchievementManager } from "./application.js";
import { Client } from "./client.js";
import { hourlyReportPath } from "./elo/eloUpdater.js";
import { createUserEloGraph } from "./graph/graph.js";
import { getRandomEnv, RandomEnv } from "./serverEnvProfile.js";
import {
	Aircraft,
	CurrentServerInformation,
	Death,
	Kill,
	logUser,
	MissileLaunchParams,
	parseAircraftString,
	parseTeamString,
	parseWeaponString,
	Spawn,
	Tracking,
	UserAircraftInformation,
	userToLimitedUser,
	Weapon
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
	position: { x: number; y: number; z: number };
	velocity: { x: number; y: number; z: number };
	team: string;
	type: string;
}

interface APIServerInfo {
	onlineUsers: string[];
	onlineUsersFull: APIUserAircraft[];
	environment: RandomEnv;
	missionId: string;
}

interface DaemonReport {
	seenSmLeaveMessage: boolean;
	seenLobbyCreationFailedMessage: boolean;
	lastHighAverageTick: number;
	exceptionSeen: boolean;
	lastRestart: number;
	lastUserJoinAttempt: number;
	lastUserJoinSuccess: number;
	lastLogMessage: number;

	lastCommandedServerStart: number;
	lastServerStop: number;
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
		onlineUsersFull: apiSI.onlineUsersFull.map(parseAPIUserAircraft),
		environment: apiSI.environment,
		missionId: apiSI.missionId
	};
}

class API {
	private server: express.Express = express();
	private websocketServer: WebSocket.Server;
	private log: Logger;
	public daemonReportCb: (report: DaemonReport) => void;
	public clients: Client[] = [];

	private achievementManager: IAchievementManager;
	constructor(private app: Application) {
		this.log = app.log;
	}

	public async init(achievementManager: IAchievementManager) {
		this.achievementManager = achievementManager;
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
		this.server.use(cors());

		this.registerRoute("GET", "users", this.getUserStats, false);
		this.registerRoute("GET", "users/:id", this.getUser, false);
		this.registerRoute("GET", "users_did/:id", this.getUserByDiscordId, false);
		this.registerRoute("GET", "kills", this.getKills, false);
		this.registerRoute("GET", "deaths", this.getDeaths, false);

		this.registerRoute("GET", "online", this.getOnlineUsers, false);
		this.registerRoute("GET", "onlinefull", this.getOnlineUsersFullStats, false);
		this.registerRoute("GET", "graph/:id", this.getUserGraph, false);
		this.registerRoute("GET", "graph/:id/:refreshId", this.getUserGraph, false);
		this.registerRoute("GET", "log/:id", this.getUserLog, false);
		this.registerRoute("GET", "multipliers", this.getMultipliers, false);
		this.registerRoute("GET", "blocklist", this.getBlockList, false);
		this.registerRoute("GET", "bannedraw", this.getBannedUsersRaw, false);
		this.registerRoute("GET", "bannedUsers", this.getBannedUsers, false);
		this.registerRoute("GET", "serverenv", this.getEnv, false);

		this.registerRoute("GET", "mods", this.getAllowedMods, true);
		this.registerRoute("GET", "liveryUpdate", this.handleLiveryUpdate, true);
		this.registerRoute("POST", "ban", this.handleUserBan, true);
		this.registerRoute("GET", "randomenv", this.getRandomEnv, true);

		const httpServer = this.server.listen(port, () => {
			this.log.info(`ELO API listening on port ${port}`);
		});

		this.websocketServer = new WebSocket.Server({ server: httpServer });
		this.websocketServer.on("connection", ws => {
			this.clients.push(new Client(this.app, ws));
		});

		setInterval(() => this.updateClients(), 100);
	}

	public sendDaemonReportRequest() {
		const daemonClient = this.clients.find(c => c.isAuthedDaemon);
		if (!daemonClient) {
			this.log.warn(`Unable to find daemon client to send report request`);
			return;
		}

		daemonClient.send({ type: "daemon_report_request" });
	}

	public sendRestartRequest() {
		const daemonClient = this.clients.find(c => c.isAuthedDaemon);
		if (!daemonClient) {
			this.log.warn(`Unable to find daemon client to send report request`);
			return;
		}

		daemonClient.send({ type: "daemon_restart" });
	}

	public sendKickUserRequest(userId: string) {
		const hsClient = this.clients.find(c => c.isAuthedHs);
		if (!hsClient) {
			this.log.warn(`Unable to find HS client to send kick request`);
			return;
		}

		hsClient.send({ type: "kick_user", data: userId });
	}

	public sendUpdatedEnvRequest() {
		const hsClient = this.clients.find(c => c.isAuthedHs);
		if (!hsClient) {
			this.log.warn(`Unable to find HS client to send weather update request`);
			return;
		}

		hsClient.send({ type: "env_update", data: this.app.currentServerEnv });
	}

	private updateClients() {
		this.clients = this.clients.filter(c => c.alive);
	}

	private async getUserStats(req: express.Request, res: express.Response) {
		const users = await this.app.users.get();
		res.send(users.map(u => userToLimitedUser(u)));
	}

	private async getUser(req: express.Request, res: express.Response) {
		let user = await this.app.users.get(req.params.id);
		if (!user) {
			user = await this.app.createNewUser(req.params.id);
		}
		if (user.rank == undefined || user.rank == null) user.rank = 0;
		res.send(user);
	}

	private async getUserByDiscordId(req: express.Request, res: express.Response) {
		if (!req.params.id) return res.sendStatus(400);
		const user = await this.app.users.collection.findOne({ discordId: req.params.id });
		if (!user) return res.sendStatus(404);
		res.send(user);
	}

	private async getKills(req: express.Request, res: express.Response) {
		if (fs.existsSync(`${hourlyReportPath}/kills.json`)) res.sendFile(path.resolve(`${hourlyReportPath}/kills.json`));
		else res.sendStatus(425);
	}

	private async getDeaths(req: express.Request, res: express.Response) {
		if (fs.existsSync(`${hourlyReportPath}/kills.json`)) res.sendFile(path.resolve(`${hourlyReportPath}/kills.json`));
		else res.sendStatus(425);
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

	public async handleUserLogin(userId: string, pilotName: string) {
		if (!userId) return 400;

		let user = await this.app.users.get(userId);
		if (!user) user = await this.app.createNewUser(userId);

		if (user.pilotNames.length == 0 || user.pilotNames[0] != pilotName) {
			this.log.info(`New pilot name for user ${logUser(user)}: ${pilotName}`);
			// user.pilotNames.unshift(req.body.pilotName);
			// Preform unshift
			await this.app.users.collection.updateOne(
				{ id: user.id },
				{
					$push: {
						pilotNames: {
							$each: [pilotName],
							$position: 0
						}
					}
				}
			);
		}

		this.log.info(`User ${logUser(user)} logged in`);
		await this.app.users.collection.updateOne({ id: user.id }, { $push: { sessions: { startTime: Date.now(), endTime: 0 } } });
		this.achievementManager.onUserLogin(user);
		return 200;
	}

	public async handleUserLogout(userId: string) {
		if (!userId) return 400;

		let user = await this.app.users.get(userId);
		if (!user) user = await this.app.createNewUser(userId);

		this.log.info(`User ${logUser(user)} logged out`);
		const lastSession = user.sessions[user.sessions.length - 1];
		if (lastSession && lastSession.endTime == 0) lastSession.endTime = Date.now();
		await this.app.users.update(user, user.id);
		this.achievementManager.onUserLogout(user);
		return 200;
	}

	public async handleKill(killReq: {
		victim: APIUserAircraft;
		killer: APIUserAircraft;
		weapon: string;
		weaponUuid: string;
		previousDamagedByUserId: string;
		previousDamagedByWeapon: string;
		serverInfo: APIServerInfo;
	}) {
		const kill: Kill = {
			id: uuidv4(),
			time: Date.now(),
			weapon: parseWeaponString(killReq.weapon),
			weaponUuid: killReq.weaponUuid,
			previousDamagedByUserId: killReq.previousDamagedByUserId,
			previousDamagedByWeapon: parseWeaponString(killReq.previousDamagedByWeapon),
			killer: parseAPIUserAircraft(killReq.killer),
			victim: parseAPIUserAircraft(killReq.victim),
			serverInfo: parseAPIServerInfo(killReq.serverInfo),
			season: this.app.elo.activeSeason.id
		};

		this.log.info(`Kill: ${kill.killer.ownerId} killed ${kill.victim.ownerId} with ${Weapon[kill.weapon]} in ${Aircraft[kill.killer.type]}`);

		// Create the death
		const death: Death = {
			id: uuidv4(),
			killId: kill.id,
			time: Date.now(),
			victim: kill.victim,
			serverInfo: kill.serverInfo,
			season: this.app.elo.activeSeason.id
		};
		this.app.kills.add(kill);
		this.app.deaths.add(death);

		const update = await this.app.elo.updateELOForKill(kill);
		if (!update) {
			return {
				killerElo: 0,
				victimElo: 0,
				eloSteal: 0
			};
		}

		const { killer, victim, eloSteal } = update;

		this.achievementManager.onKill(kill, eloSteal);
		this.achievementManager.onDeath(death, eloSteal);

		return {
			killerElo: killer.elo,
			victimElo: victim.elo,
			eloSteal: eloSteal
		};
	}

	public async handleMissileLaunchParams(paramReq: { uuid: string; type: string; team: string; launcher: APIUserAircraft; players: APIUserAircraft[] }) {
		this.log.info(`Got missile launch params for ${paramReq.uuid}`);
		const mlParams: MissileLaunchParams = {
			uuid: paramReq.uuid,
			type: parseWeaponString(paramReq.type),
			team: parseTeamString(paramReq.team),
			launcher: parseAPIUserAircraft(paramReq.launcher),
			players: paramReq.players.map(p => parseAPIUserAircraft(p)),
			season: this.app.elo.activeSeason.id
		};

		this.app.missileLaunchParams.add(mlParams);
		this.achievementManager.onMissileLaunchParams(mlParams);

		return 200;
	}

	public async handleDeath(deathReq: { victim: APIUserAircraft; serverInfo: APIServerInfo }) {
		const death: Death = {
			id: uuidv4(),
			time: Date.now(),
			victim: parseAPIUserAircraft(deathReq.victim),
			serverInfo: parseAPIServerInfo(deathReq.serverInfo),
			season: this.app.elo.activeSeason.id
		};

		this.log.info(`Death: ${death.victim.ownerId} died in ${Aircraft[death.victim.type]}`);

		this.app.deaths.add(death);
		const { eloSteal } = await this.app.elo.updateELOForDeath(death);
		this.achievementManager.onDeath(death, eloSteal);

		return 200;
	}

	public async handleSpawn(spawnReq: { user: APIUserAircraft; serverInfo: APIServerInfo }) {
		// console.log(req.body);
		// console.log(typeof req.body);
		const spawn: Spawn = {
			id: uuidv4(),
			time: Date.now(),
			user: parseAPIUserAircraft(spawnReq.user),
			serverInfo: parseAPIServerInfo(spawnReq.serverInfo),
			season: this.app.elo.activeSeason.id
		};

		this.log.info(`Spawn: ${spawn.user.ownerId} spawned in ${Aircraft[spawn.user.type]}`);
		this.app.spawns.add(spawn);

		const user = await this.app.users.get(spawn.user.ownerId);
		if (!user) return 400;
		if (!user.spawns)
			user.spawns = {
				[Aircraft.AV42c]: 0,
				[Aircraft.FA26b]: 0,
				[Aircraft.AH94]: 0,
				[Aircraft.T55]: 0,
				[Aircraft.F45A]: 0,
				[Aircraft.Invalid]: 0,
				[Aircraft.EF24G]: 0
			};
		if (!user.spawns[spawn.user.type]) user.spawns[spawn.user.type] = 0;
		user.spawns[spawn.user.type]++;
		await this.app.users.collection.updateOne({ id: user.id }, { $set: { spawns: user.spawns } });

		this.achievementManager.onUserSpawn(spawn);

		return 200;
	}

	public async handleTracking(type: string, args: any[]) {
		this.log.info(`Tracking: ${type} ${args.join(", ")}`);

		const trackingObject: Tracking = {
			id: uuidv4(),
			time: Date.now(),
			type: type,
			args: args,
			season: this.app.elo.activeSeason.id
		};
		await this.app.tracking.add(trackingObject);

		this.achievementManager.onTrackingEvent(trackingObject);

		return 200;
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

	private async handleUserBan(req: express.Request, res: express.Response) {
		const userId = req.query.userId as string;
		if (!userId) return res.sendStatus(400);

		let user = await this.app.users.get(userId);
		if (!user) user = await this.app.createNewUser(userId);

		this.log.info(`Banning user ${logUser(user)} via API`);
		await this.app.users.collection.updateOne({ id: user.id }, { $set: { isBanned: true } });
	}

	public async updateOnlineUsers(
		users: {
			name: string;
			id: string;
			team: string;
		}[]
	) {
		this.app.onlineUsers = users;
		this.app.lastOnlineUserUpdateAt = Date.now();
		this.app.updateOnlineRole();
		return 200;
	}

	public handleDaemonReport(report: DaemonReport) {
		this.log.info(`Daemon Report: ${JSON.stringify(report)}`);
		if (this.daemonReportCb) this.daemonReportCb(report);
		else this.log.warn(`No daemon report callback`);
	}

	private async getOnlineUsers(req: express.Request, res: express.Response) {
		res.send(this.app.onlineUsers);
	}

	private async getOnlineUsersFullStats(req: express.Request, res: express.Response) {
		const query = { id: { $in: this.app.onlineUsers.map(u => u.id) } };
		const users = await this.app.users.collection.find(query).toArray();
		res.send(users);
	}

	private async getBannedUsersRaw(req: express.Request, res: express.Response) {
		const bannedUsers = await this.app.users.collection.find({ isBanned: true }).toArray();
		let result = "";
		bannedUsers.forEach(user => {
			result += `${user.id},${user.pilotNames[0] ?? "Unknown"}\n`;
		});

		res.send(result);
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

	private async getRandomEnv(req: express.Request, res: express.Response) {
		this.app.currentServerEnv = getRandomEnv();
		this.handleTracking("server_env", [JSON.stringify(this.app.currentServerEnv)]);
		res.send(this.app.currentServerEnv);
	}

	private async getEnv(req: express.Request, res: express.Response) {
		res.send(this.app.currentServerEnv);
	}

	private registerRoute(
		verb: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		handler: (req: express.Request, res: express.Response) => unknown,
		auth: boolean = true
	) {
		const fullPath = ENDPOINT_BASE + (auth ? "private/" : "public/") + path;
		this.server[verb.toLowerCase()](fullPath, handler.bind(this));
		this.log.info(`Registered route (${verb}) ${fullPath}`);
	}
}

export { API, DaemonReport };
