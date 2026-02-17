import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { adminrole, Application } from "../../application.js";

class TOD extends SlashCommand {
	name = "tod";
	description = "Changes the server time of day";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({}) time: number) {
		const m = await interaction.guild.members.fetch(interaction.user.id).catch(() => {});
		if (!m || !m.roles.cache.has(adminrole)) {
			await interaction.reply(framework.error("No"));
			return;
		}

		app.currentServerEnv.tod = time;

		app.api.sendUpdatedEnvRequest();

		return framework.success(`TOD updated to ${time}`);
	}
}

export default TOD;
