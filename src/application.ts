import Discord from "discord.js";
import FrameworkClient from "strike-discord-framework";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import Logger from "strike-discord-framework/dist/logger";
import { v4 as uuidv4 } from "uuid";

import { API } from "./api.js";
import { BASE_ELO, ELOUpdater } from "./eloUpdater.js";
import { LiveryModifierManager } from "./liveryModifierManager.js";
import {
	Aircraft, AllowedMod, Death, Kill, ScoreboardMessage, Season, Spawn, Tracking, User
} from "./structures.js";

const SERVER_MAX_PLAYERS = 16;
const USERS_PER_PAGE = 30;
const KILLS_TO_RANK = 10;

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

	public scoreboardMessages: CollectionManager<string, ScoreboardMessage>;
	public allowedMods: CollectionManager<string, AllowedMod>;
	public seasons: CollectionManager<number, Season>;
	public tracking: CollectionManager<string, Tracking>;

	public api: API;
	public elo: ELOUpdater;
	public liveryUpdater: LiveryModifierManager;

	public onlineUsers: { name: string, id: string; team: string; }[] = [];

	constructor(public framework: FrameworkClient) {
		this.log = framework.log;
		this.api = new API(this);
		this.elo = new ELOUpdater(this);
		this.liveryUpdater = new LiveryModifierManager(this);
	}

	public async init() {
		this.log.info(`Application has started!`);
		this.scoreboardMessages = await this.framework.database.collection("scoreboard-messages", false, "id");

		this.users = await this.framework.database.collection("users", false, "id");
		this.allowedMods = await this.framework.database.collection("allowed-mods", false, "id");

		this.kills = await this.framework.database.collection("kills-v2", false, "id");
		this.deaths = await this.framework.database.collection("deaths-v2", false, "id");
		this.spawns = await this.framework.database.collection("spawns-v2", false, "id");
		this.seasons = await this.framework.database.collection("seasons", false, "id");
		this.tracking = await this.framework.database.collection("tracking", false, "id");

		await this.api.init();
		await this.elo.init();
		await this.updateScoreboards();

		const users = await this.users.get();
		users.forEach(async (user) => {
			if (!user.spawns) {
				user.spawns = {
					[Aircraft.AV42c]: 0,
					[Aircraft.FA26b]: 0,
					[Aircraft.F45A]: 0,
					[Aircraft.AH94]: 0,
					[Aircraft.Invalid]: 0,
					[Aircraft.T55]: 0
				};
				await this.users.update(user, user.id);
				this.log.info(`Updated user ${user.id} with new spawns object`);
			}
		});

		const interval = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60;
		const eloMultiplierUpdateRate = process.env.IS_DEV == "true" ? 1000 * 10 : 1000 * 60 * 30;
		setInterval(() => this.updateScoreboards(), interval);
		// setInterval(() => this.runHourlyTasks(), eloMultiplierUpdateRate);

		this.runHourlyTasks(); // Run it once on startup

		// this.createSeason(2, "Season 2 (T-55)");
		// this.migrateDb();
		// this.clearAllUserStats();
	}

	// private async createSeason(seasonId: number, name: string) {
	// 	const seasonDb = await this.elo.prodDb.collection("seasons", false, "id");
	// 	const season: Season = {
	// 		id: seasonId,
	// 		started: new Date().toISOString(),
	// 		ended: null,
	// 		active: false,
	// 		name: name,
	// 		totalRankedUsers: 0
	// 	};
	// 
	// 	seasonDb.add(season);
	// }

	// private async clearAllUserStats() {
	// 	console.log(`Clearing all user stats...`);
	// 	const users = await this.elo.prodUsers.get();
	// 
	// 	const proms = users.map(async (user) => {
	// 		user.kills = 0;
	// 		user.deaths = 0;
	// 		user.spawns = {
	// 			[Aircraft.AV42c]: 0,
	// 			[Aircraft.FA26b]: 0,
	// 			[Aircraft.F45A]: 0,
	// 			[Aircraft.AH94]: 0,
	// 			[Aircraft.Invalid]: 0,
	// 			[Aircraft.T55]: 0
	// 		};
	// 		user.elo = BASE_ELO;
	// 		user.eloHistory = [];
	// 		if (!user.isBanned) user.teamKills = 0;
	// 		await this.elo.prodUsers.update(user, user.id);
	// 	});
	// 	console.log(`Waiting for ${proms.length} promises to resolve...`);
	// 	await Promise.all(proms);
	// 
	// 	console.log(`Done, reset ${users.length} users!`);
	// }

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
			kills: 0,
			deaths: 0,
			rank: null,
			history: [],
			spawns: {
				[Aircraft.AV42c]: 0,
				[Aircraft.FA26b]: 0,
				[Aircraft.F45A]: 0,
				[Aircraft.AH94]: 0,
				[Aircraft.Invalid]: 0,
				[Aircraft.T55]: 0
			},
			elo: BASE_ELO,
			eloHistory: [],
			discordId: null,
			isBanned: false,
			teamKills: 0,
			endOfSeasonStats: [],
			eloFreeze: false
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
				(idx + 1),
				user.pilotNames[0],
				Math.round(user.elo),
				user.spawns[Aircraft.FA26b],
				user.spawns[Aircraft.F45A],
				user.kills,
				user.deaths,
				(user.kills / user.deaths).toFixed(2),
			]);
		});
		const multiplierTable: (string | number)[][] = [["Mult", "Type", "Count"]];
		this.elo.lastMultipliers.sort((a, b) => a.multiplier - b.multiplier).forEach((m, idx) => {
			multiplierTable.push([m.multiplier.toFixed(1) + "x", m.killStr, m.count]);
		});

		let resultStr = `**Online: ${this.onlineUsers.length}/${SERVER_MAX_PLAYERS}**\n`;
		resultStr += `\`\`\`ansi\n${this.table(table, 16).map((l, i) => {
			if (i == 0) return l;
			return prefixes[i - 1] + l + suffixes[i - 1];
		}).join("\n")}\n\`\`\`\n`;
		resultStr += `\`\`\`\n${this.table(multiplierTable, 32).join("\n")}\n\`\`\``;

		// embed.addFields({ name: "Online", value: `${this.onlineUsers.length}/${SERVER_MAX_PLAYERS}`, inline: true });
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
		const proms = scoreboards.map(async (scoreboard) => {
			const channel = await this.framework.client.channels.fetch(scoreboard.channelId).catch(() => { }) as unknown as Discord.TextChannel;
			if (!channel) return;
			const msg = await channel.messages.fetch(scoreboard.messageId).catch(() => { });
			if (!msg) return;

			await msg.edit({ embeds: [embed] }).catch((e) => {
				this.log.warn(`Unable to update scoreboard: ${e}`);
				console.log(e);
			});

			if (scoreboard.guildId == enableRankDisplayIn) {
				await this.updateUserRankDisplay();
			}
		});

		await Promise.all(proms);
	}

	public getUserRank(user: User, season: Season): number | "N/A" {
		if (!season.active) return user.endOfSeasonStats.find(s => s.season == season.id)?.rank ?? "N/A";
		return user.rank ?? "N/A";
	}

	private async updateUserRankDisplay() {
		const users = await this.users.collection.find({ discordId: { $ne: null } }).toArray();
		const server = await this.framework.client.guilds.fetch(enableRankDisplayIn).catch(() => { });
		if (!server) return this.log.error(`Unable to fetch server ${enableRankDisplayIn}`);
		const season = await this.getActiveSeason();

		const proms = users.map(async (user) => {
			const member = await server.members.fetch(user.discordId).catch(() => { });
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
				this.log.info(`Updating ${member.displayName} to ${nick}`);
				if (process.env.IS_DEV != "true") await member.setNickname(nick).catch((e) => this.log.error(`Unable to set nickname for ${member.displayName}: ${e}`));
			}
		});
		await Promise.all(proms);
	}

	public async runHourlyTasks() {
		this.elo.runHourlyTasks();
	}

	public async createNewBoard(message: Discord.Message) {
		const emb = new Discord.MessageEmbed({ title: "Scoreboard" });
		const msg = await message.channel.send({ embeds: [emb] }).catch(() => { });
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

	public async deleteBoard(scoreboard: ScoreboardMessage) {
		const channel = await this.framework.client.channels.fetch(scoreboard.channelId).catch(() => { }) as unknown as Discord.TextChannel;;
		if (channel) {
			const msg = await channel.messages.fetch(scoreboard.messageId).catch(() => { });
			if (msg) {
				await msg.delete().catch(() => { });
			} else {
				this.log.warn(`Could not find message ${scoreboard.messageId} in channel ${scoreboard.channelId} for deletion`);
			}
		} else {
			this.log.warn(`Could not find channel ${scoreboard.channelId} for deletion`);
		}

		this.log.info(`Deleting scoreboard ${scoreboard.id}`);
		await this.scoreboardMessages.remove(scoreboard.id);
	}
}

export { Application };