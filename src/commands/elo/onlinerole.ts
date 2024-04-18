import Discord, { PermissionFlagsBits, Role } from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";
import { interactionConfirm, replyOrEdit } from "../../iterConfirm.js";

class Onlinerole extends SlashCommand {
	name = "onlinerole";
	allowDm = false;
	description = "Set the role to be given to online users, max 1 per server, must be an admin to run this command";
	defaultPermission = PermissionFlagsBits.Administrator;

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg() role: Role) {
		const m = await interaction.guild.members.fetch(interaction.user.id);
		if (!m || !m.permissions.has(PermissionFlagsBits.Administrator)) {
			return framework.error(`You must be an admin to run this command`);
		}

		const existing = await app.onlineRoles.collection.findOne({ guildId: interaction.guild.id });

		if (existing) {
			const confirm = await interactionConfirm(`There is already a onlinerole in this server, do you want to delete it?`, interaction);
			if (confirm) {
				await app.deleteOnlineRole(existing);
			}
		}

		const same = await app.onlineRoles.collection.findOne({ roleId: role.id });

		if (same) {
			await replyOrEdit(interaction, framework.error(`This role is already set to be given to online users`));
			return;
		}

		const onlinerole = await app.createOnlinerole(role);
		if (!onlinerole) {
			await replyOrEdit(interaction, framework.error(`An error has occurred while creating the onlinerole`));
			return;
		}
		await replyOrEdit(interaction, framework.success(`Onlinerole created!`));
	}
}

export default Onlinerole;
