import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";
import { interactionConfirm } from "../../iterConfirm.js";

const reqRole = "1149206471146475550";
class Restart extends SlashCommand {
	name = "restart";
	allowDM = false;
	description = "Restarts the HS server. Will disconnect any current users";

	@NoArgs
	async run({ interaction, framework, app }: SlashCommandEvent<Application>) {
		const m = await interaction.guild.members.fetch(interaction.user.id);
		const userHasRole = m && m.roles.cache.has(reqRole);

		if (!userHasRole) {
			interaction.reply(framework.error("You do not have permission to run this command"));
			return;
		}

		const confirm = await interactionConfirm(
			`Are you sure you would like to restart the server? Confirm error state with \`health\` command. This will disconnect any current users`,
			interaction
		);
		if (!confirm) return;
		app.api.sendRestartRequest();
		interaction.editReply(framework.success("Server is restarting"));
	}
}

export default Restart;
