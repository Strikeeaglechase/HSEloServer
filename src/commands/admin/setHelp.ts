import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { admins, Application } from "../../application.js";

class SetHelp extends SlashCommand {
	name = "sethelp";
	description = "Sets help text";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({}) text: string) {
		const allowedRoleIds = [
			"1078735204706963457"
		];

		const member = interaction.guild?.members.cache.get(interaction.user.id);
		const hasAllowedRole = member?.roles.cache.some(role => allowedRoleIds.includes(role.id));

		if (!admins.includes(interaction.user.id) && !hasAllowedRole) {
			await interaction.reply(framework.error("No"));
			return;
		}

		await app.serverInfos.update({ id: "Help", text: text }, "Help");

		return framework.success("Updated help info");
	}
}

export default SetHelp;
