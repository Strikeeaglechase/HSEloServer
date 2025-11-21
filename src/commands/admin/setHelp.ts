import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { admins, authRoleIds, Application } from "../../application.js";

class SetHelp extends SlashCommand {
	name = "sethelp";
	description = "Sets help text";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({}) text: string) {
		const member = interaction.guild?.members.cache.get(interaction.user.id);
		const hasAllowedRole = member?.roles.cache.some(role => authRoleIds.includes(role.id));

		if (!admins.includes(interaction.user.id) && !hasAllowedRole) {
			await interaction.reply(framework.error("No"));
			return;
		}

		await app.serverInfos.collection.updateOne(
			{ id: "Help" },
			{ $set: { id: "Help", text: text } },
			{ upsert: true }
		);

		return framework.success("Updated help info");
	}
}

export default SetHelp;
