import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { adminrole, Application } from "../../application.js";

class Wind extends SlashCommand {
	name = "wind";
	description = "Sets the server wind profile";

	async run(
		{ interaction, framework, app }: SlashCommandEvent<Application>,
		@SArg({}) heading: number,
		@SArg({}) magnitude: number,
		@SArg({}) variation: number,
		@SArg({}) gust: number
	) {
		const m = await interaction.guild.members.fetch(interaction.user.id).catch(() => {});
		if (!m || !m.roles.cache.has(adminrole)) {
			await interaction.reply(framework.error("No"));
			return;
		}

		const windProfile = {
			heading: heading,
			mag: magnitude,
			vari: variation,
			gust: gust
		};

		app.currentServerEnv.wind = windProfile;

		app.api.sendUpdatedEnvRequest();

		return framework.success(`Wind profile updated`);
	}
}

export default Wind;
