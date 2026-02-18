import Discord, { ActionRowBuilder, ButtonBuilder, EmbedBuilder, Message, MessageActionRowComponentBuilder, ThreadAutoArchiveDuration } from "discord.js";
import fs from "fs";
import fetch from "node-fetch";
import { memoryUsage } from "node:process";
import FrameworkClient from "strike-discord-framework";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import Logger from "strike-discord-framework/dist/logger";
import { v4 as uuidv4 } from "uuid";

import { DummyAchievementManager, IAchievementManager } from "./achievementDeclare.js";
import { API } from "./api.js";
import { BASE_ELO, ELOUpdater, shouldKillBeCounted, userCanRank } from "./elo/eloUpdater.js";
import { LiveryModifierManager } from "./liveryModifierManager.js";
import { getRandomEnv, weatherNames } from "./serverEnvProfile.js";
import {
	AchievementDBEntry,
	AchievementLogChannel,
	Aircraft,
	AllowedMod,
	Death,
	EndOfSeasonStats,
	Kill,
	MissileLaunchParams,
	OnlineboardMessage,
	OnlineRole,
	RandomEnv,
	ScoreboardMessage,
	Season,
	ServerInfoEntry,
	Spawn,
	Tracking,
	UnbanRequest,
	User,
	Weapon
} from "./structures.js";

const admins = ["272143648114606083", "500744458699276288"];
const adminrole = "1281305915064062044";
const SERVER_MAX_PLAYERS = 16;
const USERS_PER_PAGE = 30;
const KILLS_TO_RANK = 10;
const SERVER_TOD_RATE = 2;
const achievementsEnabled = true;
const enableRankDisplayIn = "1015729793733492756"; // Did I just hardcode a server ID? Yes, yes I did.
const devUnbanReqChannel = "1350513509284446228";
const prodUnbanReqChannel = "1350531719245336637";

function strCmpNoWhitespace(a: string, b: string) {
	return a.replace(/\s/g, "") == b.replace(/\s/g, "");
}

class Application {
	public log: Logger;

	public users: CollectionManager<User>;
	// public killsOld: CollectionManager<string, KillOld>;
	// public deathsOld: CollectionManager<string, DeathOld>;
	// public spawnsOld: CollectionManager<string, SpawnOld>;

	public kills: CollectionManager<Kill>;
	public deaths: CollectionManager<Death>;
	public spawns: CollectionManager<Spawn>;
	public missileLaunchParams: CollectionManager<MissileLaunchParams>;

	public scoreboardMessages: CollectionManager<ScoreboardMessage>;
	public onlineboardMessages: CollectionManager<OnlineboardMessage>;
	public achievementLogChannels: CollectionManager<AchievementLogChannel>;
	public onlineRoles: CollectionManager<OnlineRole>;
	public allowedMods: CollectionManager<AllowedMod>;
	public seasons: CollectionManager<Season>;
	public tracking: CollectionManager<Tracking>;
	public endOfSeasonStats: CollectionManager<EndOfSeasonStats>;
	public unbanRequests: CollectionManager<UnbanRequest>;
	public serverInfos: CollectionManager<ServerInfoEntry>;
	public serverHelps: CollectionManager<ServerInfoEntry>;

	public achievementManager: IAchievementManager = new DummyAchievementManager();
	public achievementsDb: CollectionManager<AchievementDBEntry>;

	public api: API;
	public elo: ELOUpdater;
	public liveryUpdater: LiveryModifierManager;

	public onlineUsers: { name: string; id: string; team: string }[] = [];
	public currentServerEnv: RandomEnv;
	private currentMission: string = "";
	public lastOnlineUserUpdateAt = 0;
	public matchStartTime = 0;

	private updatingRanksAt = 0;
	private lastHighMemoryReset = 0;

	private vcChannelNames: Record<string, { name: string; isChanged: boolean }> = {};
	private ptTargetUserId: string = "663567155513655316";
	private ptChannelName = "Pound Town VC";

	constructor(public framework: FrameworkClient) {
		this.log = framework.log;
		this.api = new API(this);
		this.elo = new ELOUpdater(this);
		this.liveryUpdater = new LiveryModifierManager(this);
	}

	private async loadAchievementManager() {
		if (fs.existsSync("./achievementSystem/achievementManager.js") && achievementsEnabled) {
			this.log.info(`Loading achievement manager`);
			//@ts-ignore
			const { AchievementManager } = await import("./achievementSystem/achievementManager.js");
			this.achievementManager = new AchievementManager(this);
			await this.achievementManager.init();
			this.log.info(`Loaded achievement manager`);
		} else {
			this.log.warn(`Unable to find achievementManager.js`);
			return;
		}
	}

	private ptChannelUpdate(oldState, newState) {
		if (oldState.channelId && this.vcChannelNames[oldState.channelId]) {
			if (this.vcChannelNames[oldState.channelId].isChanged) {
				oldState.channel.setName(this.vcChannelNames[oldState.channelId].name).catch(e => this.log.error(`Unable to set channel name: ${e}`));
				this.vcChannelNames[oldState.channelId].isChanged = false;
			}
		}
		if (newState.channelId) {
			if (this.vcChannelNames[newState.channelId]) {
				newState.channel.setName(this.ptChannelName).catch(e => this.log.error(`Unable to set channel name: ${e}`));
				this.vcChannelNames[newState.channelId].isChanged = true;
			} else {
				this.vcChannelNames[newState.channelId] = { name: newState.channel.name, isChanged: false };
				newState.channel.setName(this.ptChannelName).catch(e => this.log.error(`Unable to set channel name: ${e}`));
				this.vcChannelNames[newState.channelId].isChanged = true;
			}
		}
	}

	public async init() {
		this.currentServerEnv = getRandomEnv();
		this.log.info(`Application has started!`);
		await this.setupDbCollections();

		this.log.info(`Loaded all collections`);
		if (process.env.IS_DEV != "true") this.loadAchievementManager();
		// this.loadAchievementManager();
		this.log.info(`Loaded achievement manager`);
		await this.api.init();
		this.api.on("tracking", (tracking: Tracking) => {
			this.handleTracking(tracking);
		});
		this.log.info(`Loaded API`);
		await this.elo.init();
		this.log.info(`Loaded ELO updater`);
		await this.updateScoreboards();
		this.log.info(`Updated scoreboards`);

		const users = await this.users.get();
		this.log.info(`Fetched ${users.length} users`);
		const proms = users.map(async user => {
			if (!user.spawns) {
				user.spawns = {
					[Aircraft.AV42c]: 0,
					[Aircraft.FA26b]: 0,
					[Aircraft.F45A]: 0,
					[Aircraft.AH94]: 0,
					[Aircraft.Invalid]: 0,
					[Aircraft.T55]: 0,
					[Aircraft.EF24G]: 0
				};
				await this.users.update(user, user.id);
				this.log.info(`Updated user ${user.id} with new spawns object`);
			}

			if (!user.achievements) {
				await this.users.collection.updateOne({ id: user.id }, { $set: { achievements: [] } });
				this.log.info(`Updated user ${user.id} with new achievements object`);
			}

			if ("eloGainLossSummary" in user) {
				await this.users.collection.updateOne({ id: user.id }, { $unset: { eloGainLossSummary: "" } });
			}
			if (!("altIds" in user)) {
				// @ts-ignore
				await this.users.collection.updateOne({ id: user.id }, { $set: { altIds: [] } });
			}
			if (!("options" in user)) {
				// @ts-ignore
				await this.users.collection.updateOne({ id: user.id }, { $set: { options: {} } });
			}
		});
		await Promise.all(proms);
		this.log.info(`Updated all users with new spawns object`);

		this.framework.client.on("messageCreate", msg => {
			if (msg.author.bot) return;
			const unbanReqChannel = process.env.IS_DEV == "true" ? devUnbanReqChannel : prodUnbanReqChannel;
			if (msg.channel.isThread() && msg.channel.parentId == unbanReqChannel) this.handleUnbanRequestChannelMessage(msg);
			else if (msg.channel.id == unbanReqChannel) this.handleUnbanRequestChannelMessage(msg);
		});
		this.framework.client.on("interactionCreate", async interaction => {
			if (!interaction.isButton()) return;
			if (interaction.customId == "unban-channel") this.handleUnbanButton(interaction);
		});

		this.framework.client.on("voiceStateUpdate", async (oldState, newState) => {
			if (newState.id != this.ptTargetUserId) return;
			this.ptChannelUpdate(oldState, newState);
		});

		const scoreboardUpdateRate = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60; // 10 seconds in dev, 1 minute in prod
		const eloMultiplierUpdateRate = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60 * 60; // 10 seconds in dev, 1 hour in prod
		const userRankUpdateRate = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60 * 15; // 10 seconds in dev, 15 minutes in prod

		setInterval(() => this.updateScoreboards(), scoreboardUpdateRate);
		setInterval(() => this.updateOnlineboards(), scoreboardUpdateRate);
		setInterval(() => this.preformUserRankUpdate(), userRankUpdateRate);
		setInterval(() => (this.currentServerEnv.tod += SERVER_TOD_RATE / 60), 1000 * 60);
		if (process.env.IS_DEV != "true") {
			setInterval(() => this.checkMemoryUsage(), 1000);
			setInterval(() => this.runHourlyTasks(), eloMultiplierUpdateRate);
		}

		this.runHourlyTasks(); // Run it once on startup

		// this.createSeason(4, "Season 4 (Weather)");
		// this.migrateDb();
	}

	private async handleTracking(tracking: Tracking) {
		switch (tracking.type) {
			case "mission":
				const missionName = tracking.args[0].match(/\/([\w ]+).vts/)[1];
				this.currentMission = missionName;
				this.matchStartTime = Date.now();
				this.log.info(`Received mission name via tracking: ${missionName}`);
				break;

			case "invalid_user_nid":
				const [_, userId] = tracking.args;
				this.log.info(`Received invalid user nid: ${userId}`);

				const user = await this.users.get(userId);

				if (!user) {
					this.log.error(`Unable to find user ${userId} in database`);
					return;
				}
				const modEmbed = await this.createModerationEmbed(user);
				const embed = new EmbedBuilder().setTitle("Invalid User NID").setDescription(`User ID: ${userId}`).setColor(0xff0000).setTimestamp();

				admins.forEach(async adminId => {
					const admin = await this.framework.client.users.fetch(adminId).catch(() => {});
					if (!admin) return;

					const dmChannel = await admin.createDM().catch(() => {});
					if (!dmChannel) return;

					await dmChannel.send({ embeds: [embed, modEmbed] }).catch(e => {
						this.log.error(`Unable to send DM to admin ${adminId}: ${e}`);
					});
				});
				break;
		}
	}

	private async setupDbCollections() {
		this.scoreboardMessages = await this.framework.database.collection("scoreboard-messages", false, "id");
		this.onlineboardMessages = await this.framework.database.collection("onlineboard-messages", false, "id");
		this.achievementLogChannels = await this.framework.database.collection("achievement-log-channels", false, "channelId");

		this.onlineRoles = await this.framework.database.collection("online-roles", false, "id");

		this.users = await this.framework.database.collection("users", false, "id");
		this.allowedMods = await this.framework.database.collection("allowed-mods", false, "id");

		this.kills = await this.framework.database.collection("kills-v2", false, "id");
		this.deaths = await this.framework.database.collection("deaths-v2", false, "id");
		this.spawns = await this.framework.database.collection("spawns-v2", false, "id");
		this.seasons = await this.framework.database.collection("seasons", false, "id");
		this.tracking = await this.framework.database.collection("tracking", false, "id");
		this.endOfSeasonStats = await this.framework.database.collection("end-of-season-stats", false, "id");
		this.missileLaunchParams = await this.framework.database.collection("missiles", false, "uuid");
		this.achievementsDb = await this.framework.database.collection("achievements", false, "id");
		this.unbanRequests = await this.framework.database.collection("unban-requests", false, "id");
		this.serverInfos = await this.framework.database.collection("server-info", false, "id");
		this.serverHelps = await this.framework.database.collection("server-help", false, "id");
	}

	private async checkMemoryUsage() {
		const memUsage = process.memoryUsage();
		const usageGb = memUsage.heapUsed / 1024 / 1024 / 1024;
		this.log.info(`Memory usage: ${usageGb.toFixed(2)}GB`);
		if (usageGb > 2.5) {
			const timeFromLastReset = Date.now() - this.lastHighMemoryReset;
			// One minute
			if (timeFromLastReset < 1000 * 60) return;
			this.lastHighMemoryReset = Date.now();
			this.log.info(`Force closing database connection due to high memory usage`);
			this.framework.database.client.close(true);
			await this.framework.database.init();
			await this.setupDbCollections();
			// debugger;
		}
	}

	public async getActiveSeason(seasonDb = this.seasons): Promise<Season> {
		const activeSeason = await seasonDb.collection.findOne({ active: true });
		if (!activeSeason) {
			this.log.error(`Unable to find active season!`);
			return {
				id: -1,
				started: "XX-XX-XXXX",
				ended: null,
				active: false,
				name: "Invalid Season",
				totalRankedUsers: 0,
				endStats: {
					achievementHistory: []
				}
			};
		}

		return activeSeason;
	}

	public async getSeason(id: number, seasonDb = this.seasons): Promise<Season> {
		return seasonDb.get(id as unknown as string); // TODO: Do not fucking do this
	}

	public async createNewUser(id: string) {
		const user: User = {
			id: id,
			pilotNames: [],
			altIds: [],
			isAlt: false,
			altParentId: null,
			loginTimes: [],
			logoutTimes: [],
			sessions: [],
			kills: 0,
			deaths: 0,
			rank: null,
			history: [],
			ignoreKillsAgainstUsers: [],
			spawns: {
				[Aircraft.AV42c]: 0,
				[Aircraft.FA26b]: 0,
				[Aircraft.F45A]: 0,
				[Aircraft.AH94]: 0,
				[Aircraft.Invalid]: 0,
				[Aircraft.T55]: 0,
				[Aircraft.EF24G]: 0
			},
			elo: BASE_ELO,
			eloHistory: [],
			discordId: null,
			isBanned: false,
			isBahaBanned: false,
			teamKills: 0,
			eloFreeze: false,
			achievements: [],
			canBeFirstWithAchievement: true,
			voiceMuted: false,
			options: {}
		};
		await this.users.add(user);
		return user;
	}

	private async getMainAircraft(userId: string): Promise<string> {
		const season = await this.getActiveSeason();
		const kills = await this.kills.collection.find({ "killer.ownerId": userId, "season": season.id }).toArray();

		const killsByAircraft: Record<number, number> = {};
		kills.forEach(kill => {
			const aircraftType = kill.killer.type;
			killsByAircraft[aircraftType] = (killsByAircraft[aircraftType] || 0) + 1;
		});

		let maxKills = 0;
		let mainAircraft = Aircraft.Invalid;

		Object.entries(killsByAircraft).forEach(([aircraftStr, killCount]) => {
			const aircraft = parseInt(aircraftStr) as Aircraft;
			if (aircraft !== Aircraft.Invalid && killCount > maxKills) {
				maxKills = killCount;
				mainAircraft = aircraft;
			}
		});

		return mainAircraft === Aircraft.Invalid ? "N/A" : Aircraft[mainAircraft];
	}

	private async createScoreboardMessage() {
		const embed = new Discord.EmbedBuilder({ title: "Scoreboard" });
		// const filteredUsers = this.cachedSortedUsers.filter(u => u.elo != BASE_ELO && u.kills > KILLS_TO_RANK).slice(0, USERS_PER_PAGE);
		let filteredUsers = await this.users.collection.find({ rank: { $lte: USERS_PER_PAGE, $gt: 0 } }).toArray();
		filteredUsers = filteredUsers.sort((a, b) => b.elo - a.elo);
		// ```ansi;
		// Offline player
		// Offline player
		// [1;2m[1;37mOnline player[0m[0m
		// Offline player
		// ```
		const table: (string | number)[][] = [["#", "Name", "ELO", "Kills", "Deaths", "Main Aircraft", "KDR"]];
		const prefixes: string[] = [];
		const suffixes: string[] = [];
		for (let idx = 0; idx < filteredUsers.length; idx++) {
			const user = filteredUsers[idx];
			const isOnline = this.onlineUsers.some(u => u.id == user.id);
			const prefix = isOnline ? "[1;2m[1;37m" : "";
			const suffix = isOnline ? "[0m[0m" : "";
			const mainAircraft = await this.getMainAircraft(user.id);
			prefixes.push(prefix);
			suffixes.push(suffix);

			table.push([idx + 1, user.pilotNames[0], Math.round(user.elo), user.kills, user.deaths, mainAircraft, (user.kills / user.deaths).toFixed(2)]);
		}
		const multiplierTable: (string | number)[][] = [["Mult", "Type", "Count"]];
		this.elo.lastMultipliers
			.sort((a, b) => a.multiplier - b.multiplier)
			.forEach((m, idx) => {
				multiplierTable.push([m.multiplier.toFixed(1) + "x", m.killStr, m.count]);
			});

		let resultStr = `**Online: ${this.onlineUsers.length}/${SERVER_MAX_PLAYERS}**\n`;
		resultStr += `\`\`\`ansi\n${this.table(table, 16, [3, 4, 5])
			.map((l, i) => {
				if (i == 0) return l;
				return prefixes[i - 1] + l + suffixes[i - 1];
			})
			.join("\n")}\n\`\`\`\n`;
		resultStr += `\`\`\`\n${this.table(multiplierTable, 32).join("\n")}\n\`\`\``;

		// embed.addFields({ name: "Online", value: `${this.onlineUsers.length}/${SERVER_MAX_PLAYERS}`, inline: true });
		embed.setDescription(resultStr);
		embed.setTimestamp();
		return embed;
	}

	private async createOnlineboardMessage() {
		const embed = new Discord.EmbedBuilder({ title: "Onlineboard" });
		// const filteredUsers = this.cachedSortedUsers.filter(u => u.elo != BASE_ELO && u.kills > KILLS_TO_RANK).slice(0, USERS_PER_PAGE);
		let onlineUsers = await Promise.all(this.onlineUsers.map(async user => this.users.get(user.id)));
		onlineUsers = onlineUsers.sort((a, b) => b.elo - a.elo);

		let min = onlineUsers.length > 0 ? onlineUsers[0].elo : 0;
		let max = 0;
		let avg = 0;

		const table: (string | number)[][] = [["Name", "ELO", "K/D", "Team", "Aircraft"]];

		// Get current session start time (last online user update)
		// const sessionStartTime = this.lastOnlineUserUpdateAt;
		const activeSeason = await this.getActiveSeason();

		await Promise.all(
			onlineUsers.map(async (user, idx) => {
				const team = this.onlineUsers.find(u => u.id === user.id).team;

				const latestSpawn = await this.spawns.collection.findOne({ "user.ownerId": user.id, "season": activeSeason.id }, { sort: { time: -1 } });
				let aircraftName = latestSpawn ? Aircraft[latestSpawn.user.type] : "Unknown";

				const hasMultipleOccupants = latestSpawn?.user?.occupants && Array.isArray(latestSpawn.user.occupants) && latestSpawn.user.occupants.length > 1;
				
				if (hasMultipleOccupants) {
					const seatIndex = latestSpawn.user.occupants.indexOf(user.id);

					if (seatIndex >= 0) {
						if (latestSpawn.user.type === Aircraft.EF24G) {
							// EF-24G: index 0 = Pilot, index 1 = EWO
							if (seatIndex === 0) {
								aircraftName += " (Pilot)";
							} else if (seatIndex === 1) {
								aircraftName += " (EWO)";
							}
						} else if (latestSpawn.user.type === Aircraft.T55) {
							// T-55: index 0 = Pilot, index 1 = Instructor
							if (seatIndex === 0) {
								aircraftName += " (Pilot)";
							} else if (seatIndex === 1) {
								aircraftName += " (Instructor)";
							}
						}
					}
				}

				const sessionKills = await this.kills.collection.countDocuments({
					"killer.ownerId": user.id,
					"season": activeSeason.id,
					"time": { $gte: this.matchStartTime }
				});	

				const sessionDeaths = await this.deaths.collection.countDocuments({
					"victim.ownerId": user.id,
					"season": activeSeason.id,
					"time": { $gte: this.matchStartTime }
				});

				const kd = `${sessionKills}/${sessionDeaths}`;

				min = Math.min(min, user.elo);
				max = Math.max(max, user.elo);
				avg += user.elo;

				table.push([user.pilotNames[0], Math.round(user.elo), kd, team, aircraftName]);
			})
		);

		let resultStr = `**Online: ${this.onlineUsers.length}/${SERVER_MAX_PLAYERS}**\n`;
		resultStr += `\`\`\`ansi\n${this.table(table, 16).join("\n")}\n\`\`\`\n`;
		resultStr += `\`\`\`Min: ${Math.round(min)} | Max: ${Math.round(max)} | Avg: ${Math.round(avg / onlineUsers.length)}\`\`\`\n`;

		resultStr += `\`\`\`ansi\n[1;2m[1;37mATIS[0m[0m\n`;
		const windKn = (this.currentServerEnv.wind.mag * 1.94384).toFixed(0);
		const windHeading = this.currentServerEnv.wind.heading.toFixed(0).padStart(3, "0");
		const gustKnRaw = (this.currentServerEnv.wind.gust + this.currentServerEnv.wind.mag) * 1.94384;
		const gustKn = this.currentServerEnv.wind.gust > 1 ? `, gusting ${gustKnRaw.toFixed(0)}` : "";
		const timeHrs = Math.floor(this.currentServerEnv.tod).toString().padStart(2, "0");
		const timeMins = Math.floor((this.currentServerEnv.tod % 1) * 60)
			.toString()
			.padStart(2, "0");

		const matchDurationMs = this.matchStartTime ? Date.now() - this.matchStartTime : 0;
		const matchDurationMins = Math.floor(matchDurationMs / 60000);

		resultStr += `${this.currentMission ?? ""}\nMatch Duration: ${matchDurationMins} min\nTOD ${timeHrs}:${timeMins}\nWind ${windHeading} @ ${windKn}kts${gustKn}\nWeather ${
			weatherNames[this.currentServerEnv.weather]
		}`;
		resultStr += `\n\`\`\``;

		embed.setDescription(resultStr);
		embed.setTimestamp();
		return embed;
	}

	public table(data: (string | number)[][], tEntryMaxLen = 16, centerColumns: number[] = []) {
		const widths = data[0].map((_, i) => Math.max(...data.map(row => String(row[i]).length)));
		return data.map(row =>
			row
				.map((val, i) => {
					const str = String(val);
					if (centerColumns.includes(i)) {
						const totalPadding = widths[i] - str.length;
						const leftPadding = Math.floor(totalPadding / 2);
						const rightPadding = totalPadding - leftPadding;
						return " ".repeat(leftPadding) + str + " ".repeat(rightPadding);
					}
					return str.padEnd(widths[i]);
				})
				.map(val => val.substring(0, tEntryMaxLen))
				.join(" ")
		);
	}

	private async updateScoreboards() {
		const scoreboards = await this.scoreboardMessages.get();
		const embed = await this.createScoreboardMessage();
		const proms = scoreboards.map(async scoreboard => {
			const channel = (await this.framework.client.channels.fetch(scoreboard.channelId).catch(() => {})) as unknown as Discord.TextChannel;
			if (!channel) return;
			const msg = await channel.messages.fetch(scoreboard.messageId).catch(() => {});
			if (!msg) return;

			await msg.edit({ embeds: [embed] }).catch(e => {
				this.log.warn(`Unable to update scoreboard: ${e}`);
				console.log(e);
			});

			// if (scoreboard.guildId == enableRankDisplayIn) {
			// 	await this.updateUserRankDisplay();
			// }
		});

		await Promise.all(proms);
	}

	private async updateOnlineboards() {
		const onlineboards = await this.onlineboardMessages.get();
		const embed = await this.createOnlineboardMessage();
		const proms = onlineboards.map(async onlineboard => {
			const channel = (await this.framework.client.channels.fetch(onlineboard.channelId).catch(() => {})) as unknown as Discord.TextChannel;
			if (!channel) return;
			const msg = await channel.messages.fetch(onlineboard.messageId).catch(() => {});
			if (!msg) return;

			await msg.edit({ embeds: [embed] }).catch(e => {
				this.log.warn(`Unable to update scoreboard: ${e}`);
				console.log(e);
			});
		});

		await Promise.all(proms);
	}

	private async preformUserRankUpdate() {
		this.log.info(`Updating user ranks`);
		const users = await this.users.collection.find({ kills: { $gt: KILLS_TO_RANK } }).toArray();
		this.log.info(`Found ${users.length} users that have the kills to rank`);
		const usersThatCanRank = users.filter(u => userCanRank(u));
		this.log.info(`Of those, ${usersThatCanRank.length} can rank`);
		usersThatCanRank.sort((a, b) => b.elo - a.elo);

		const proms = usersThatCanRank.map(async (user, idx) => {
			const newUserRank = idx + 1;
			if (user.rank != newUserRank) {
				user.rank = newUserRank;
				// await this.users.update(user, user.id);
				await this.users.collection.updateOne({ id: user.id }, { $set: { rank: newUserRank } });
			}
		});

		await Promise.all(proms);

		await this.updateUserRankDisplay();
	}

	public getUserRank(user: User, season: Season, endOfSeasonStats: EndOfSeasonStats): number | "N/A" {
		if (!season.active) return endOfSeasonStats?.rank ?? "N/A";
		return user.rank ?? "N/A";
	}

	private async updateUserRankDisplay() {
		const deltaFromLast = Date.now() - this.updatingRanksAt;
		if (deltaFromLast < 1000 * 60 * 5) {
			// 5 minutes
			// this.log.error(`UpdateUserRankDisplay called with short delta: ${deltaFromLast}ms`);
			return;
		}
		this.updatingRanksAt = Date.now();

		const users = await this.users.collection.find({ discordId: { $ne: null } }).toArray();
		this.log.info(`Updating rank display, found ${users.length} users with discord ids`);
		const server = await this.framework.client.guilds.fetch(enableRankDisplayIn).catch(() => {});
		if (!server) return this.log.error(`Unable to fetch server ${enableRankDisplayIn}`);
		const season = await this.getActiveSeason();

		await server.members.fetch();
		this.log.info(`Loaded ${server.members.cache.size} members from server ${enableRankDisplayIn}`);
		const proms = users.map(async user => {
			const member = await server.members.fetch(user.discordId).catch(() => {});
			if (!member) return;
			const rawRank = this.getUserRank(user, season, null);
			let rank = rawRank.toString().padStart(3, "0") + ". ";
			if (rawRank == "N/A") rank = "";
			else if (rawRank > 999) rank = "";
			else if (!rawRank) rank = "";

			// Check to see if they already have a rank in their name
			let nick: string;
			if (!member.user) {
				this.log.warn(`Member ${member.id} has no user`);
				return;
			}
			const displayNameParts = (member.displayName ?? member.user.username).split(".").map(p => p.trim());
			if (member.displayName != member.user.username && !isNaN(parseInt(displayNameParts[0]))) {
				const name = displayNameParts.slice(1).join(".");
				nick = `${rank}${name}`.substring(0, 32);
			} else {
				nick = `${rank}${member.displayName}`.substring(0, 32);
			}

			if (member.displayName != nick) {
				// this.log.info(`Updating ${member.displayName} to ${nick}`);
				if (process.env.IS_DEV != "true" && member.id != "272143648114606083")
					await member.setNickname(nick).catch(e => this.log.error(`Unable to set nickname for ${member.displayName}: ${e}`));
			}
		});
		await Promise.all(proms);

		this.log.info(`Verified user nicknames`);
	}

	public async runHourlyTasks() {
		this.elo.runHourlyTasks();
		this.updateMpBanList();
	}

	private async updateMpBanList() {
		this.log.info(`Updating MP ban list`);
		try {
			const mpBanList = await fetch("https://vtolvr.bdynamicsstudio.com/mp_bans.txt");
			const text = await mpBanList.text();
			const lines = text.split("\n");
			const bannedUserLines = lines.map(l => l.trim()).filter(l => l.length > 0);
			const bannedUsers = bannedUserLines.map(l => {
				const parts = l.split(";");
				const [id, reason] = parts;

				return { id, reason };
			});

			bannedUsers.forEach(async user => {
				await this.users.collection.updateOne({ id: user.id }, { $set: { isBahaBanned: true, isBanned: true } });
				this.log.info(`MP Banned user ${user.id} for reason: ${user.reason}`);
			});
		} catch (e) {
			this.log.error(`Unable to fetch MP ban list: ${e}`);
		}
	}

	public async updateOnlineRole() {
		let onlineRoles = await this.onlineRoles.get();
		let onlineUsers = await Promise.all(this.onlineUsers.map(async user => this.users.get(user.id)));
		onlineUsers = onlineUsers.filter(u => u != null && u != undefined && u.discordId != null && u.discordId != undefined);

		onlineRoles.forEach(async onlineRole => {
			const guild = await this.framework.client.guilds.fetch(onlineRole.guildId).catch(() => {});
			if (!guild) return;

			const guildOnlineRole = await guild.roles.fetch(onlineRole.roleId).catch(() => {});
			if (!guildOnlineRole) return;

			const onlineGuildMembers = (await Promise.all(onlineUsers.map(async user => guild.members.fetch(user.discordId).catch(() => {})))).filter(
				u => u != undefined && u instanceof Discord.GuildMember
			) as unknown as Discord.GuildMember[];

			const toAddOnlineRole = onlineGuildMembers.filter(m => !guildOnlineRole.members.has(m.id));
			const toRemoveOnlineRole = guildOnlineRole.members.filter(m => !onlineGuildMembers.some(u => u.id == m.id));
			toAddOnlineRole.forEach(async member => await member.roles.add(guildOnlineRole).catch(() => {}));
			toRemoveOnlineRole.forEach(async member => await member.roles.remove(guildOnlineRole).catch(() => {}));

			if (onlineRole.teamAId && onlineRole.teamBId) {
				const guildTeamARole = await guild.roles.fetch(onlineRole.teamAId).catch(() => {});
				const guildTeamBRole = await guild.roles.fetch(onlineRole.teamBId).catch(() => {});
				if (!guildTeamARole || !guildTeamBRole) return;

				const toRemoveTeamAMembers = guildTeamARole.members.filter(m => {
					const user = onlineUsers.find(u => u.discordId == m.id);
					if (!user) return true;
					const team = this.onlineUsers.find(u => u.id == user.id)?.team;
					return team != "Allied";
				});

				const toRemoveTeamBMembers = guildTeamBRole.members.filter(m => {
					const user = onlineUsers.find(u => u.discordId == m.id);
					if (!user) return true;
					const team = this.onlineUsers.find(u => u.id == user.id)?.team;
					return team != "Enemy";
				});

				const toAddTeamAMembers = onlineGuildMembers.filter(m => {
					const user = onlineUsers.find(u => u.discordId == m.id);
					if (!user) return false;
					const team = this.onlineUsers.find(u => u.id == user.id)?.team;
					return team == "Allied";
				});

				const toAddTeamBMembers = onlineGuildMembers.filter(m => {
					const user = onlineUsers.find(u => u.discordId == m.id);
					if (!user) return false;
					const team = this.onlineUsers.find(u => u.id == user.id)?.team;
					return team == "Enemy";
				});

				toAddTeamAMembers.forEach(async member => await member.roles.add(guildTeamARole).catch(() => {}));
				toAddTeamBMembers.forEach(async member => await member.roles.add(guildTeamBRole).catch(() => {}));
				toRemoveTeamAMembers.forEach(async member => await member.roles.remove(guildTeamARole).catch(() => {}));
				toRemoveTeamBMembers.forEach(async member => await member.roles.remove(guildTeamBRole).catch(() => {}));
			}
		});
	}

	public async createScoreboard(interaction: Discord.CommandInteraction) {
		const emb = new Discord.EmbedBuilder({ title: "Scoreboard" });
		const msg = await interaction.channel.send({ embeds: [emb] }).catch(() => {});
		if (!msg) {
			this.log.error(`Unable to send message in channel ${interaction.channel.id}`);
			return;
		}

		const scoreboard: ScoreboardMessage = {
			messageId: msg.id,
			channelId: msg.channel.id,
			guildId: msg.guild.id,
			id: uuidv4()
		};
		await this.scoreboardMessages.add(scoreboard);

		this.log.info(`Created new scoreboard ${scoreboard.id} (${scoreboard.messageId}) in channel ${scoreboard.channelId} in guild ${scoreboard.guildId}`);
		return scoreboard;
	}

	public async createOnlineboard(interaction: Discord.CommandInteraction) {
		const emb = new Discord.EmbedBuilder({ title: "Online" });
		const msg = await interaction.channel.send({ embeds: [emb] }).catch(() => {});
		if (!msg) {
			this.log.error(`Unable to send message in channel ${interaction.channel.id}`);
			return;
		}

		const onlineboard: OnlineboardMessage = {
			messageId: msg.id,
			channelId: msg.channel.id,
			guildId: msg.guild.id,
			id: uuidv4()
		};
		await this.onlineboardMessages.add(onlineboard);

		this.log.info(`Created new onlineboard ${onlineboard.id} (${onlineboard.messageId}) in channel ${onlineboard.channelId} in guild ${onlineboard.guildId}`);
		return onlineboard;
	}

	public async createAchievementLogChannel(channel: Discord.TextChannel) {
		const entry: AchievementLogChannel = {
			channelId: channel.id,
			guildId: channel.guild.id
		};

		await this.achievementLogChannels.add(entry);
		this.log.info(`Created new achievement log channel ${entry.channelId} in guild ${entry.guildId}`);
	}

	public async createOnlinerole(role: Discord.Role) {
		const onlinerole: OnlineRole = {
			roleId: role.id,
			guildId: role.guild.id,
			teamAId: "",
			teamBId: "",
			id: uuidv4()
		};
		await this.onlineRoles.add(onlinerole);

		this.log.info(`Created new onlinerole ${onlinerole.id} (${onlinerole.roleId}) in guild ${onlinerole.guildId}`);
		return onlinerole;
	}

	public async deleteScoreboard(scoreboard: ScoreboardMessage) {
		const channel = (await this.framework.client.channels.fetch(scoreboard.channelId).catch(() => {})) as unknown as Discord.TextChannel;
		if (channel) {
			const msg = await channel.messages.fetch(scoreboard.messageId).catch(() => {});
			if (msg) {
				await msg.delete().catch(() => {});
			} else {
				this.log.warn(`Could not find message ${scoreboard.messageId} in channel ${scoreboard.channelId} for deletion`);
			}
		} else {
			this.log.warn(`Could not find channel ${scoreboard.channelId} for deletion`);
		}

		this.log.info(`Deleting scoreboard ${scoreboard.id}`);
		await this.scoreboardMessages.remove(scoreboard.id);
	}

	public async deleteOnlineboard(onlineboard: OnlineboardMessage) {
		const channel = (await this.framework.client.channels.fetch(onlineboard.channelId).catch(() => {})) as unknown as Discord.TextChannel;
		if (channel) {
			const msg = await channel.messages.fetch(onlineboard.messageId).catch(() => {});
			if (msg) {
				await msg.delete().catch(() => {});
			} else {
				this.log.warn(`Could not find message ${onlineboard.messageId} in channel ${onlineboard.channelId} for deletion`);
			}
		} else {
			this.log.warn(`Could not find channel ${onlineboard.channelId} for deletion`);
		}

		this.log.info(`Deleting onlineboard ${onlineboard.id}`);
		await this.onlineboardMessages.remove(onlineboard.id);
	}

	public async deleteAchievementLogChannel(achievementLogChannel: AchievementLogChannel) {
		this.log.info(`Deleting achievement log channel ${achievementLogChannel.channelId}`);
		await this.achievementLogChannels.remove(achievementLogChannel.channelId);
	}

	public async deleteOnlineRole(onlinerole: OnlineRole) {
		this.log.info(`Deleting onlinerole ${onlinerole.id}`);
		await this.onlineRoles.remove(onlinerole.id);
	}

	public async createModerationEmbed(userEntry: User) {
		const MAX_SHOWN_TKs = 10;
		const activeSeason = await this.getActiveSeason();
		const kills = await this.kills.collection.find({ "killer.ownerId": userEntry.id, "season": activeSeason.id }).toArray();
		kills.sort((a, b) => b.time - a.time);
		const realKills = kills.filter(k => k.killer.team != k.victim.team && shouldKillBeCounted(k) && k.weapon != Weapon.Collision && k.weapon != Weapon.CFIT);
		const killsWithoutCollisions = kills.filter(k => k.weapon != Weapon.Collision);
		const collisionTks = kills.filter(k => k.weapon == Weapon.Collision && k.killer.team === k.victim.team);
		const allTks = killsWithoutCollisions.filter(k => k.killer.team === k.victim.team);

		let tkLog = "";
		for (let i = 0; i < Math.min(allTks.length, MAX_SHOWN_TKs); i++) {
			const tk = allTks[i];
			if (!tk) {
				this.log.warn(`Null TK for mod embed of ${userEntry.id}`);
			}
			const victim = await this.users.get(tk.victim.ownerId);

			const time = new Date(tk.time).toISOString().split(".")[0];
			if (tk.weapon == Weapon.Gun) {
				const victimSpeed = Math.sqrt(tk.victim.velocity.x ** 2 + tk.victim.velocity.y ** 2 + tk.victim.velocity.z ** 2);
				const victimSpeedKnots = (victimSpeed * 1.94384).toFixed(0);
				const victimAltFt = (tk.victim.position.y * 3.28084).toFixed(0);
				tkLog += `[${time}] ${victim.pilotNames[0] ?? victim.id} ${Weapon[tk.weapon]} ${victimSpeedKnots}kts ${victimAltFt}ft\n`;
			} else {
				tkLog += `[${time}] ${victim.pilotNames[0] ?? victim.id} ${Weapon[tk.weapon]}\n`;
			}
		}

		const season = await this.getActiveSeason();
		const killsThisSeason = realKills.filter(k => k.season == season.id);
		const tksThisSeason = allTks.filter(k => k.season == season.id);

		const names = [...new Set(userEntry.pilotNames)];

		const embed = new EmbedBuilder();
		embed.setTitle(`Moderation info for ${userEntry.pilotNames[0] ?? userEntry.id}`);
		const fields: { name: string; value: string; inline?: boolean }[] = [
			{
				name: "Names",
				value: names.join("\n") || "Unknown",
				inline: true
			},
			{
				name: "Kills",
				value: `Season: ${killsThisSeason.length}\nRKT: ${realKills.length}\nTotal: ${kills.length}`,
				inline: true
			},
			{
				name: "TKs",
				value: `Season: ${tksThisSeason.length}\nTotal: ${allTks.length}\nDB: ${userEntry.teamKills}\nCollision: ${collisionTks.length}`,
				inline: true
			}
		];

		if (userEntry.isAlt) {
			const parent = await this.users.get(userEntry.altParentId);
			fields.push({ name: "Alt of", value: `${parent.pilotNames[0]} (${parent.id})`, inline: true });
		}

		if (userEntry.altIds.length > 0) {
			const alts = await Promise.all(
				userEntry.altIds.map(async id => {
					return await this.users.get(id);
				})
			);
			fields.push({ name: "Alts", value: alts.map(a => `${a.pilotNames[0]} (${a.id})`).join("\n"), inline: true });
		}

		if (userEntry.discordId) {
			fields.push({ name: "Discord", value: `<@${userEntry.discordId}>`, inline: true });
		}

		embed.addFields(fields);

		const nidFails = await this.tracking.collection.find({ "type": "invalid_user_nid", "args.1": userEntry.id }).toArray();
		if (nidFails.length > 0) {
			embed.setColor(Discord.Colors.Red);
			embed.addFields({
				name: "NID Fails",
				value: nidFails.length.toString()
			});
		}

		embed.setDescription(`\`\`\`\n${tkLog}\n\`\`\``);
		embed.setFooter({ text: `${userEntry.id} | Is banned: ${!!userEntry.isBanned}` });

		return embed;
	}

	private tryExtractSteamId(content: string) {
		const match = content.match(/(?:\D(\d{17})\D)|(?:^(\d{17})\D)|(?:\D(\d{17})$)|(?:^(\d{17})$)/);
		if (!match) return null;
		return match[1] ?? match[2] ?? match[3] ?? match[4];
	}

	private async handleUnbanRequestChannelMessage(message: Message) {
		if (message.channel.isThread()) {
			const request = await this.unbanRequests.collection.findOne({ threadId: message.channel.id });
			if (!request) return;
			if (request.hasReceivedUserId) return;

			const userId = this.tryExtractSteamId(message.content);
			if (!userId) return;

			const user = await this.users.get(userId);
			if (!user) {
				message.reply(
					`This message appears to contain the SteamID \`${userId}\`, however that user has never connected to the server. Please make sure to provide your own SteamID64`
				);
				return;
			}

			if (!user.isBanned) {
				message.reply(
					`This message appears to contain the SteamID \`${userId}\`, however that user is not banned. Please make sure to provide your own SteamID64`
				);
				return;
			}

			await this.unbanRequests.collection.updateOne({ threadId: message.channel.id }, { $set: { hasReceivedUserId: true, userId: user.id } });
			const name = user.pilotNames[0] ?? user.id;
			message.channel.setName(`Unban Request - ${name}`);

			const embed = await this.createModerationEmbed(user);
			const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				new ButtonBuilder().setCustomId("unban-channel").setLabel("Unban").setStyle(Discord.ButtonStyle.Success)
			);

			message.channel.send({ content: `Received SteamID \`${userId}\``, embeds: [embed], components: [row] });
		} else {
			if (!message.channel.isTextBased() || !(message.channel instanceof Discord.TextChannel)) return;

			const userId = this.tryExtractSteamId(message.content);
			const user = userId ? await this.users.get(userId) : null;
			if (user && !user.isBanned) {
				await message.author
					.send(
						this.framework.error(
							`The unban request you created for ${user.pilotNames[0]} (${user.id}) has been automatically closed as they are not banned`
						)
					)
					.catch(() => {});
				await message.delete().catch(() => {});
				return;
			}
			const name = user ? (user.pilotNames[0] ?? user.id) : "Unknown";

			const thread = await message.channel.threads.create({
				name: `Unban Request - ${name}`,
				autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
				reason: "Unban request thread",
				startMessage: message
			});

			const request: UnbanRequest = {
				createdAt: Date.now(),
				hasReceivedUserId: false,
				closed: false,
				userId: userId,
				threadId: thread.id,
				id: uuidv4()
			};
			await this.unbanRequests.add(request);

			if (!userId) {
				const embed = new EmbedBuilder();
				embed.setTitle("Unban Request");
				embed.setDescription(
					`You did not provide a SteamID64 in your message, please send it here. If you are unsure how to find it this website may help: https://steamid.io/, additionally a link to your steam profile will work if you do not have a vanity URL. \n\If you didn't already please provide an explanation as to why you are banned/what happened/other context that may be important`
				);
				thread.send({ embeds: [embed] });
			} else if (!user) {
				const embed = new EmbedBuilder();
				embed.setTitle("Unban Request");
				embed.setDescription(
					`The SteamID64 ${userId} was provided, however that user has never connected to the server, please provide your own SteamID64. If you are unsure how to find it this website may help: https://steamid.io/, additionally a link to your steam profile will work if you do not have a vanity URL. \n\If you didn't already please provide an explanation as to why you are banned/what happened/other context that may be important`
				);
				thread.send({ embeds: [embed] });
			} else {
				const embed = new EmbedBuilder();
				embed.setTitle("Unban Request");
				embed.setDescription(
					`If you didn't already please provide an explanation as to why you are banned/what happened/other context that may be important`
				);

				const modEmbed = await this.createModerationEmbed(user);
				const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder().setCustomId("unban-channel").setLabel("Unban").setStyle(Discord.ButtonStyle.Success)
				);
				thread.send({ embeds: [embed, modEmbed], components: [row] });
			}
		}
	}

	private async handleUnbanButton(interaction: Discord.ButtonInteraction) {
		if (!admins.includes(interaction.user.id)) return interaction.reply(this.framework.error("Only an admin can unban users", true));

		const request = await this.unbanRequests.collection.findOne({ threadId: interaction.channel.id });
		if (!request) {
			return interaction.reply(this.framework.error("The unban request for that interaction could not be found", true));
		}

		const thread = interaction.channel;
		if (!thread.isThread() || thread.id != request.threadId) {
			return interaction.reply(this.framework.error("The interaction origin channel does not match the request thread id", true));
		}

		const user = await this.users.collection.findOne({ id: request.userId });
		if (!user) {
			return interaction.reply(this.framework.error("The user for the unban request could not be found", true));
		}

		await this.users.collection.updateOne({ id: user.id }, { $set: { isBanned: false, teamKills: 0 } });
		await this.unbanRequests.collection.updateOne({ threadId: interaction.channel.id }, { $set: { closed: true } });
		await interaction.channel.send(this.framework.success(`User ${user.pilotNames[0]} (${user.id}) has been unbanned`));
		await interaction.reply(this.framework.success(`Unbanned`, true));

		const builder = new EmbedBuilder(interaction.message.embeds[interaction.message.embeds.length - 1]);
		builder.setFooter({ text: `${user.id} | Is banned: ${false}` });
		builder.setColor("Green");
		const allEmbeds = interaction.message.embeds.length > 1 ? [interaction.message.embeds[0], builder] : [builder];
		await interaction.message.edit({ embeds: allEmbeds, components: [] });

		await thread.setLocked(true);
		await thread.setArchived(true);
	}
}

export { Application, IAchievementManager, KILLS_TO_RANK, achievementsEnabled, admins, adminrole };
