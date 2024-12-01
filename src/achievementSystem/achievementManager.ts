import { EmbedBuilder } from "discord.js";
import Logger from "strike-discord-framework/dist/logger.js";

import { Application, IAchievementManager } from "../application.js";
import { EventEmitter } from "../eventEmitter.js";
import { AchievementDBEntry, Death, Kill, MissileLaunchParams, Spawn, Tracking, User } from "../structures.js";
import { Achievement, AchievementId } from "./achievement.js";
import { GoogleSheetParser } from "./sheetParser.js";

type EmittedEvents = "user_kill" | "user_death" | "tracking_event" | "user_login" | "user_logout" | "linked_account" | "missile_launch_params" | "user_spawn";
class AchievementManager extends EventEmitter<EmittedEvents> implements IAchievementManager {
	public log: Logger;
	private sheetParser: GoogleSheetParser;
	private achievements: Achievement[];

	constructor(public app: Application) {
		super();
		this.log = app.log;
		this.sheetParser = new GoogleSheetParser("1QmcBkwDHOdzIdSpknXPXygk_eyxrFil-19qau-SB-N4", this);
	}

	public async init() {
		await this.sheetParser.init();
		await Achievement.loadAchievementClasses(this.log);
		this.achievements = await this.sheetParser.parseAchievements();
		this.log.info(`Parsed ${this.achievements.length} achievements`);

		this.achievements.forEach(async ac => {
			const dbEntry = await this.app.achievementsDb.get(ac.id);
			if (!dbEntry) {
				const newEntry: AchievementDBEntry = {
					id: ac.id,
					users: [],
					firstAchieved: 0,
					messages: []
				};

				await this.app.achievementsDb.add(newEntry);
				this.log.info(`Added achievement ${ac.id} to database`);
			}
		});
		// this.achievements[1].giveToUser("76561198985917972");

		// setTimeout(() => {
		// }, 3 * 1000);
	}

	public async onAchievementGiven(user: User, achievement: Achievement) {
		const dbEntry = await this.app.achievementsDb.get(achievement.id);

		// First time this user got this achievement
		if (!dbEntry.users.includes(user.id)) {
			if (user.canBeFirstWithAchievement !== false || dbEntry.users.length > 0)
				await this.app.achievementsDb.collection.updateOne({ id: achievement.id }, { $addToSet: { users: user.id } });

			await this.app.users.collection.updateOne({ id: user.id }, { $push: { achievements: { count: 1, firstAchieved: Date.now(), id: achievement.id } } });

			// Update achievement counts
			dbEntry.messages.forEach(async msg => {
				const channel = await this.app.framework.client.channels.fetch(msg.channelId).catch((): null => null);
				if (!channel || !channel.isTextBased()) return;
				const message = await channel.messages.fetch(msg.messageId).catch((): null => null);
				if (!message) return;

				const embed = new EmbedBuilder(message.embeds[0]);
				embed.setDescription(achievement.description + `\n\n${dbEntry.users.length + 1} players have this achievement`);
				await message.edit({ embeds: [embed] }).catch((): null => null);
			});

			// User has linked account, lets send them a message
			if (user.discordId) {
				const dUser = await this.app.framework.client.users.fetch(user.discordId).catch((): null => null);
				if (dUser) {
					const embed = new EmbedBuilder();
					embed.setTitle(`Got achievement: ${achievement.name}`);
					embed.setDescription(achievement.description);
					embed.setTimestamp();

					await dUser.send({ embeds: [embed] }).catch((): null => null);
				}
			}
		} else {
			await this.app.users.collection.updateOne(
				{ id: user.id },
				{ $inc: { "achievements.$[achIdx].count": 1 } },
				{ arrayFilters: [{ "achIdx.id": achievement.id }] }
			);
		}

		// First time this achievement was achieved
		if (dbEntry.users.length == 0 && user.canBeFirstWithAchievement !== false) {
			await this.app.achievementsDb.collection.updateOne({ id: achievement.id }, { $set: { firstAchieved: Date.now(), firstAchievedBy: user.id } });
			this.log.info(`Achievement ${achievement.id} was first achieved by ${user.id}`);

			// Send messages to discord log channels
			const ts = Math.floor(Date.now() / 1000);
			const name = user.discordId ? `<@${user.discordId}>` : user.pilotNames[0];
			const messageText = `${name} was the first to achieve \`${achievement.name}\` on <t:${ts}:f>!`;
			const message = new EmbedBuilder();
			message.setTitle(achievement.name);
			message.setDescription(achievement.description + `\n\n1 player has this achievement`);
			message.setFooter({ text: user.id + " | " + achievement.id });

			const channels = await this.app.achievementLogChannels.get();
			const messageProms = channels.map(async channel => {
				const channelObj = await this.app.framework.client.channels.fetch(channel.channelId).catch((): null => null);

				if (channelObj && channelObj.isTextBased()) {
					const id = await channelObj.send({ content: messageText, embeds: [message] }).catch((): null => null);
					if (id) return { channelId: channel.channelId, messageId: id.id };
				}
			});
			const messages = (await Promise.all(messageProms)).filter(m => m);
			await this.app.achievementsDb.collection.updateOne({ id: achievement.id }, { $set: { messages } });
		}
	}

	public getAchievement(id: AchievementId) {
		return this.achievements.find(a => a.id == id);
	}

	public onKill(kill: Kill, eloDelta: number) {
		this.emit("user_kill", kill, eloDelta);
	}
	public onDeath(death: Death, eloDelta: number) {
		this.emit("user_death", death, eloDelta);
	}
	public onTrackingEvent(tracking: Tracking) {
		this.emit("tracking_event", tracking);
	}
	public onUserLogin(user: User) {
		this.emit("user_login", user);
	}
	public onUserLogout(user: User) {
		this.emit("user_logout", user);
	}
	public onUserSpawn(spawn: Spawn) {
		this.emit("user_spawn", spawn);
	}
	public onLinkedAccount(user: User) {
		this.emit("linked_account", user);
	}
	public onMissileLaunchParams(params: MissileLaunchParams) {
		this.emit("missile_launch_params", params);
	}
}

export { AchievementManager };
