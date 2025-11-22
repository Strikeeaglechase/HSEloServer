import { CommandInteraction } from "discord.js";
import FrameworkClient from "strike-discord-framework";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";

import { Application } from "../../application.js";
import { User } from "../../structures.js";

export async function lookupUser(users: CollectionManager<User>, query: string) {
	// SteamID
	if (query.match(/(https):\/\/steamcommunity\.com\/profiles\/[0-9]+|(http):\/\/steamcommunity\.com\/profiles\/[0-9]+/gim)) {
		const userIdUser = await users.get(query.replace(/(https):\/\/steamcommunity\.com\/profiles\/|(http):\/\/steamcommunity\.com\/profiles\//gim, ""));
		if (userIdUser) return userIdUser;
	} else if (query.match(/[0-9]+/gim)) {
		const userIdUser = await users.get(query);
		if (userIdUser) return userIdUser;
	}

	// DiscordID
	if (query.match(/<@[0-9]+>/gim)) {
		const discordIdUser = await users.collection.findOne({
			discordId: query.replace(/<@|>/gim, "")
		});
		if (discordIdUser) return discordIdUser;
	} else if (query.match(/[0-9]+/gim)) {
		const discordIdUser = await users.collection.findOne({ discordId: query });
		if (discordIdUser) return discordIdUser;
	}

	console.log(`Doing regex query for ${query}`);
	// PilotName
	const pilotNameUser = await users.collection
		.find({ pilotNames: { $regex: new RegExp(query, "i") } })
		.limit(100)
		.toArray();
	if (pilotNameUser.length > 0) {
		return pilotNameUser.sort((a, b) => b.elo - a.elo)[0];
	}
}

export async function resolveUser(username: string, framework: FrameworkClient, app: Application, interaction: CommandInteraction) {
	let user: User;
	if (username) {
		user = await lookupUser(app.users, username);
		if (!user) {
			await interaction.editReply(framework.error(`Could not find a user with that id/name`));
			return null;
		}
	} else {
		const linkedUser = await app.users.collection.findOne({
			discordId: interaction.user.id
		});
		if (!linkedUser) {
			interaction.editReply(framework.error(`You must be linked to a steam account to use this command without an argument. \`/link <steamid>\``));
			return null;
		}
		user = linkedUser;
	}

	return user;
}

export async function resolveSeason(season: number, framework: FrameworkClient, app: Application, interaction: CommandInteraction) {
	const activeSeason = await app.getActiveSeason();
	let targetSeason = activeSeason;
	if (season) {
		targetSeason = await app.getSeason(season);
		if (!targetSeason) {
			interaction.editReply(framework.error(`Could not find that season`));
			return null;
		}
	}

	return targetSeason;
}
