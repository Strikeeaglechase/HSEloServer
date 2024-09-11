import Discord from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { admins, Application } from "../../application.js";

class Ban extends SlashCommand {
	name = "ban";
	description = "Bans a user";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({}) userId: string) {
		if (!admins.includes(interaction.user.id)) {
			await interaction.reply(framework.error("No"));
			return;
		}

		let user = await app.users.get(userId);
		if (!user) user = await app.createNewUser(userId);

		user.isBanned = true;
		await app.users.update(user, user.id);

		return framework.success(`Banned ${user.pilotNames[0] ?? user.id}`);
	}
}

export default Ban;
