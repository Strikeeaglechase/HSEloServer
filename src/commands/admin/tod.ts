import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { admins, Application } from "../../application.js";

class TOD extends SlashCommand {
	name = "tod";
	description = "Changes the server time of day";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({}) time: number) {
		if (!admins.includes(interaction.user.id)) {
			await interaction.reply(framework.error("No"));
			return;
		}

		app.currentServerEnv.tod = time;

		app.api.sendUpdatedEnvRequest();

		return framework.success(`TOD updated to ${time}`);
	}
}

export default TOD;
