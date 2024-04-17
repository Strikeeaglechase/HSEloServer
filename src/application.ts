import Discord from "discord.js";
import fs from "fs";
import FrameworkClient from "strike-discord-framework";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import Logger from "strike-discord-framework/dist/logger";
import { v4 as uuidv4 } from "uuid";

import { DummyAchievementManager, IAchievementManager } from "./achievementDeclare.js";
import { API } from "./api.js";
import { BASE_ELO, ELOUpdater, userCanRank } from "./elo/eloUpdater.js";
import { LiveryModifierManager } from "./liveryModifierManager.js";
import {
	AchievementDBEntry,
	AchievementLogChannel,
	Aircraft,
	AllowedMod,
	Death,
	Kill,
	MissileLaunchParams,
	OnlineboardMessage,
	OnlineRole,
	ScoreboardMessage,
	Season,
	Spawn,
	Tracking,
	User
} from "./structures.js";

const SERVER_MAX_PLAYERS = 16;
const USERS_PER_PAGE = 30;
const KILLS_TO_RANK = 10;
const achievementsEnabled = true;
const enableRankDisplayIn = "1015729793733492756"; // Did I just hardcode a server ID? Yes, yes I did.

function strCmpNoWhitespace(a: string, b: string) {
	return a.replace(/\s/g, "") == b.replace(/\s/g, "");
}

class Application {
	public log: Logger;

	public users: CollectionManager<string, User>;
	// public killsOld: CollectionManager<string, KillOld>;
	// public deathsOld: CollectionManager<string, DeathOld>;
	// public spawnsOld: CollectionManager<string, SpawnOld>;

	public kills: CollectionManager<string, Kill>;
	public deaths: CollectionManager<string, Death>;
	public spawns: CollectionManager<string, Spawn>;
	public missileLaunchParams: CollectionManager<string, MissileLaunchParams>;

	public scoreboardMessages: CollectionManager<string, ScoreboardMessage>;
	public onlineboardMessages: CollectionManager<string, OnlineboardMessage>;
	public achievementLogChannels: CollectionManager<string, AchievementLogChannel>;
	public onlineRoles: CollectionManager<String, OnlineRole>;
	public allowedMods: CollectionManager<string, AllowedMod>;
	public seasons: CollectionManager<number, Season>;
	public tracking: CollectionManager<string, Tracking>;

	public achievementManager: IAchievementManager = new DummyAchievementManager();
	public achievementsDb: CollectionManager<string, AchievementDBEntry>;

	public api: API;
	public elo: ELOUpdater;
	public liveryUpdater: LiveryModifierManager;

	public onlineUsers: { name: string; id: string; team: string }[] = [];
	public lastOnlineUserUpdateAt = 0;

	private isUpdatingRanks = false;

	constructor(public framework: FrameworkClient) {
		this.log = framework.log;
		this.api = new API(this);
		this.elo = new ELOUpdater(this);
		this.liveryUpdater = new LiveryModifierManager(this);
	}

	private async loadAchievementManager() {
		if (fs.existsSync("./achievementSystem/achievementManager.js") && achievementsEnabled) {
			this.log.info(`Loading achievement manager`);
			const { AchievementManager } = await import("./achievementSystem/achievementManager.js");
			this.achievementManager = new AchievementManager(this);
			await this.achievementManager.init();
		} else {
			this.log.warn(`Unable to find achievementManager.js`);
			return;
		}
	}

	public async init() {
		this.log.info(`Application has started!`);
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
		this.missileLaunchParams = await this.framework.database.collection("missiles", false, "uuid");
		this.achievementsDb = await this.framework.database.collection("achievements", false, "id");

		this.log.info(`Loaded all collections`);
		await this.loadAchievementManager();
		this.log.info(`Loaded achievement manager`);
		await this.api.init(this.achievementManager);
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
		});
		await Promise.all(proms);
		this.log.info(`Updated all users with new spawns object`);

		const scoreboardUpdateRate = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60; // 10 seconds in dev, 1 minute in prod
		const eloMultiplierUpdateRate = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60 * 60; // 10 seconds in dev, 1 hour in prod
		const userRankUpdateRate = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60 * 15; // 10 seconds in dev, 15 minutes in prod

		setInterval(() => this.updateScoreboards(), scoreboardUpdateRate);
		setInterval(() => this.updateOnlineboards(), scoreboardUpdateRate);
		setInterval(() => this.preformUserRankUpdate(), userRankUpdateRate);
		if (process.env.IS_DEV != "true") setInterval(() => this.runHourlyTasks(), eloMultiplierUpdateRate);

		this.runHourlyTasks(); // Run it once on startup

		// this.createSeason(3, "Season 3 (EF-24G)");
		// this.migrateDb();
	}

	private async createSeason(seasonId: number, name: string) {
		const season: Season = {
			id: seasonId,
			started: new Date().toISOString(),
			ended: null,
			active: false,
			name: name,
			totalRankedUsers: 0
		};

		this.seasons.add(season);
	}

	private async clearAllUserStats() {
		console.log(`Clearing all user stats...`);
		const users = await this.users.get();

		const proms = users.map(async user => {
			user.kills = 0;
			user.deaths = 0;
			user.spawns = {
				[Aircraft.AV42c]: 0,
				[Aircraft.FA26b]: 0,
				[Aircraft.F45A]: 0,
				[Aircraft.AH94]: 0,
				[Aircraft.Invalid]: 0,
				[Aircraft.T55]: 0,
				[Aircraft.EF24G]: 0
			};
			user.elo = BASE_ELO;
			user.eloHistory = [];
			if (!user.isBanned) user.teamKills = 0;
			await this.users.update(user, user.id);
		});
		console.log(`Waiting for ${proms.length} promises to resolve...`);
		await Promise.all(proms);

		console.log(`Done, reset ${users.length} users!`);
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
				totalRankedUsers: 0
			};
		}

		return activeSeason;
	}

	public async getSeason(id: number, seasonDb = this.seasons): Promise<Season> {
		return seasonDb.get(id);
	}

	public async createNewUser(id: string) {
		const user: User = {
			id: id,
			pilotNames: [],
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
			teamKills: 0,
			endOfSeasonStats: [],
			eloFreeze: false,
			eloGainLossSummary: {},
			achievements: [],
			canBeFirstWithAchievement: true
		};
		await this.users.add(user);
		return user;
	}

	private async createScoreboardMessage() {
		const embed = new Discord.MessageEmbed({ title: "Scoreboard" });
		// const filteredUsers = this.cachedSortedUsers.filter(u => u.elo != BASE_ELO && u.kills > KILLS_TO_RANK).slice(0, USERS_PER_PAGE);
		let filteredUsers = await this.users.collection.find({ rank: { $lte: USERS_PER_PAGE } }).toArray();
		filteredUsers = filteredUsers.sort((a, b) => b.elo - a.elo);
		// ```ansi;
		// Offline player
		// Offline player
		// [1;2m[1;37mOnline player[0m[0m
		// Offline player
		// ```
		const table: (string | number)[][] = [["#", "Name", "ELO", "F/A-26b", "F-45A", "Kills", "Deaths", "KDR"]];
		const prefixes: string[] = [];
		const suffixes: string[] = [];
		filteredUsers.forEach((user, idx) => {
			const isOnline = this.onlineUsers.some(u => u.id == user.id);
			const prefix = isOnline ? "[1;2m[1;37m" : "";
			const suffix = isOnline ? "[0m[0m" : "";
			prefixes.push(prefix);
			suffixes.push(suffix);
			table.push([
				idx + 1,
				user.pilotNames[0],
				Math.round(user.elo),
				user.spawns[Aircraft.FA26b],
				user.spawns[Aircraft.F45A],
				user.kills,
				user.deaths,
				(user.kills / user.deaths).toFixed(2)
			]);
		});
		const multiplierTable: (string | number)[][] = [["Mult", "Type", "Count"]];
		this.elo.lastMultipliers
			.sort((a, b) => a.multiplier - b.multiplier)
			.forEach((m, idx) => {
				multiplierTable.push([m.multiplier.toFixed(1) + "x", m.killStr, m.count]);
			});

		let resultStr = `**Online: ${this.onlineUsers.length}/${SERVER_MAX_PLAYERS}**\n`;
		resultStr += `\`\`\`ansi\n${this.table(table, 16)
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
		const embed = new Discord.MessageEmbed({ title: "Onlineboard" });
		// const filteredUsers = this.cachedSortedUsers.filter(u => u.elo != BASE_ELO && u.kills > KILLS_TO_RANK).slice(0, USERS_PER_PAGE);
		let onlineUsers = await Promise.all(this.onlineUsers.map(async user => this.users.get(user.id)));
		onlineUsers = onlineUsers.sort((a, b) => b.elo - a.elo);

		let min = onlineUsers.length > 0 ? onlineUsers[0].elo : 0;
		let max = 0;
		let avg = 0;

		const table: (string | number)[][] = [["Name", "ELO", "Team"]];
		onlineUsers.forEach((user, idx) => {
			const team = this.onlineUsers.find(u => u.id === user.id).team;

			min = Math.min(min, user.elo);
			max = Math.max(max, user.elo);
			avg += user.elo;

			table.push([user.pilotNames[0], Math.round(user.elo), team]);
		});

		let resultStr = `**Online: ${this.onlineUsers.length}/${SERVER_MAX_PLAYERS}**\n`;
		resultStr += `\`\`\`ansi\n${this.table(table, 16).join("\n")}\n\`\`\`\n`;
		resultStr += `\`\`\`Min: ${Math.round(min)} | Max: ${Math.round(max)} | Avg: ${Math.round(avg / onlineUsers.length)}\`\`\`\n`;

		embed.setDescription(resultStr);
		embed.setTimestamp();
		return embed;
	}

	public table(data: (string | number)[][], tEntryMaxLen = 16) {
		const widths = data[0].map((_, i) => Math.max(...data.map(row => String(row[i]).length)));
		return data.map(row => row.map((val, i) => String(val).padEnd(widths[i]).substring(0, tEntryMaxLen)).join(" "));
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

	public getUserRank(user: User, season: Season): number | "N/A" {
		if (!season.active) return user.endOfSeasonStats.find(s => s.season == season.id)?.rank ?? "N/A";
		return user.rank ?? "N/A";
	}

	private async updateUserRankDisplay() {
		if (this.isUpdatingRanks) {
			this.log.error(`UpdateUserRankDisplay called while already updating ranks`);
			return;
		}
		this.isUpdatingRanks = true;

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
			const rawRank = this.getUserRank(user, season);
			let rank = rawRank.toString().padStart(3, "0") + ". ";
			if (rawRank == "N/A") rank = "";
			else if (rawRank > 999) rank = "";

			// Check to see if they already have a rank in their name
			let nick: string;
			const displayNameParts = member.displayName.split(".").map(p => p.trim());
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

		this.isUpdatingRanks = false;

		this.log.info(`Verified user nicknames`);
	}

	public async runHourlyTasks() {
		this.elo.runHourlyTasks();
	}

	public async updateOnlineRole() {
		let onlineRoles = await this.onlineRoles.get();
		let onlineUsers = await Promise.all(this.onlineUsers.map(async user => this.users.get(user.id)));
		onlineUsers = onlineUsers.filter(u => u != null && u != undefined && u.discordId != null && u.discordId != undefined);

		onlineRoles.forEach(async onlineRole => {
			const guild = await this.framework.client.guilds.fetch(onlineRole.guildId).catch(() => {});
			if (!guild) return;

			const role = await guild.roles.fetch(onlineRole.roleId).catch(() => {});
			if (!role) return;

			const onlineGuildMembers = (await Promise.all(onlineUsers.map(async user => guild.members.fetch(user.discordId).catch(() => {})))).filter(
				u => u != undefined && u instanceof Discord.GuildMember
			) as unknown as Discord.GuildMember[];

			const toAdd = onlineGuildMembers.filter(m => !role.members.has(m.id));
			const toRemove = role.members.filter(m => !onlineGuildMembers.some(u => u.id == m.id));

			toAdd.forEach(async member => {
				await member.roles.add(role).catch(() => {});
			});
			toRemove.forEach(async member => {
				await member.roles.remove(role).catch(() => {});
			});
		});
	}

	public async createScoreboard(message: Discord.Message) {
		const emb = new Discord.MessageEmbed({ title: "Scoreboard" });
		const msg = await message.channel.send({ embeds: [emb] }).catch(() => {});
		if (!msg) {
			this.log.error(`Unable to send message in channel ${message.channel.id}`);
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

	public async createOnlineboard(message: Discord.Message) {
		const emb = new Discord.MessageEmbed({ title: "Online" });
		const msg = await message.channel.send({ embeds: [emb] }).catch(() => {});
		if (!msg) {
			this.log.error(`Unable to send message in channel ${message.channel.id}`);
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
}

export { Application, IAchievementManager, KILLS_TO_RANK, achievementsEnabled };
