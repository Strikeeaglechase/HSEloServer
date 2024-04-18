import { PermissionFlagsBits } from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";
import { interactionConfirm, replyOrEdit } from "../../iterConfirm.js";

class Onlineboard extends SlashCommand {
	name = "onlineboard";
	allowDm = false;
	description = "Creates the onlineboard listing, max 1 per server, must be an admin to run this command";

	defaultPermission = PermissionFlagsBits.Administrator;

	@NoArgs
	async run({ interaction, framework, app }: SlashCommandEvent<Application>) {
		const m = await interaction.guild.members.fetch(interaction.user.id);
		if (!m || !m.permissions.has(PermissionFlagsBits.Administrator)) {
			await interaction.reply(framework.error(`You must be an admin to run this command`, true));
			return;
		}

		const existing = await app.onlineboardMessages.collection.findOne({ guildId: interaction.guild.id });

		if (existing) {
			// const confirm = await framework.utils.reactConfirm(`There is already a onlineboard in this server, do you want to delete it?`, message);
			const confirm = await interactionConfirm(`There is already a onlineboard in this server, do you want to delete it?`, interaction, true);
			if (confirm) {
				await app.deleteOnlineboard(existing);
			}
		}

		const onlineboard = await app.createOnlineboard(interaction);
		if (!onlineboard) {
			replyOrEdit(interaction, framework.error(`An error has occurred while creating the onlineboard`, true));
			return;
		}
		await replyOrEdit(interaction, framework.success(`Onlineboard created!`, true));
	}
}

export default Onlineboard;
