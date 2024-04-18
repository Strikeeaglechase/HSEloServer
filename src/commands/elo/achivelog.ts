import { PermissionFlagsBits, TextChannel } from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";
import { interactionConfirm, replyOrEdit } from "../../iterConfirm.js";

class AchieveLog extends SlashCommand {
	name = "achievelog";
	description = "Creates the achievement log channel, max 1 per server, must be an admin to run this command";
	defaultPermission = PermissionFlagsBits.Administrator;

	@NoArgs
	async run({ interaction, framework, app }: SlashCommandEvent<Application>) {
		const m = await interaction.guild.members.fetch(interaction.user.id);
		if (!m || !m.permissions.has(PermissionFlagsBits.Administrator)) {
			await interaction.reply(framework.error(`You must be an admin to run this command`, true));
			return;
		}

		const existing = await app.achievementLogChannels.collection.findOne({ guildId: interaction.guild.id });

		if (existing) {
			// const confirm = await framework.utils.reactConfirm(`There is already a onlineboard in this server, do you want to delete it?`, message);
			const confirm = await interactionConfirm(`There is already a achievement log in this server, do you want to delete it?`, interaction, true);
			if (confirm) {
				await app.deleteAchievementLogChannel(existing);
			}
		}

		await app.createAchievementLogChannel(interaction.channel as TextChannel);

		await replyOrEdit(interaction, framework.success(`Set this channel for achievement logs!`, true));
	}
}

export default AchieveLog;
