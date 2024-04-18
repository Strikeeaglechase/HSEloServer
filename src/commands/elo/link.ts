import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";
import { replyOrEdit } from "../../iterConfirm.js";

const nums = "0123456789";

class Link extends SlashCommand {
	name = "link";
	description = "Links your discord account to your steam";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg() steamId: string) {
		// Check steamid is numeric
		const isNumeric = steamId.split("").every(c => nums.includes(c));
		if (!isNumeric) {
			interaction.reply(framework.error(`Please provide your steamID64 (https://steamid.io/lookup/${steamId})`));
			return;
		}

		// Check existing
		const existing = await app.users.collection.findOne({ discordId: interaction.user.id });
		if (existing) {
			replyOrEdit(interaction, framework.error(`You are already linked to ${existing.pilotNames[0]} (${existing.id})`));

			return;
		}

		// Check steamid exists
		const user = await app.users.get(steamId);
		if (!user) {
			replyOrEdit(interaction, framework.error(`That steamID does not exist (connect to the server at least once)`));
			return;
		}

		// Check steamid is not link1ed
		if (user.discordId) {
			replyOrEdit(interaction, framework.error(`That steamID is already linked to a discord account`));
			return;
		}

		// Link
		user.discordId = interaction.user.id;
		await app.users.update(user, user.id);
		app.achievementManager.onLinkedAccount(user);

		replyOrEdit(interaction, framework.success(`You are now linked to ${user.pilotNames[0]} (${user.id})`));
	}
}

export default Link;
