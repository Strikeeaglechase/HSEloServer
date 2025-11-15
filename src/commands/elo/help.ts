import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs, SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";

class Help extends SlashCommand {

	name = "help";
	description = "Displays help information";

	@NoArgs
	async run({ interaction, framework, app }: SlashCommandEvent<Application>) {

		await interaction.deferReply();
		await interaction.editReply(
			"Are you banned from the VTOL server in-game? Request unban here: https://discord.com/channels/1015729793733492756/1350531719245336637\n\n" +
				"Are you a new player needing help learning the basics/more advanced techniques for pvp? Check out: https://discord.com/channels/1015729793733492756/1078734984719892500\n\n" +
				"Want to support the AIP (AI Pilot) project? Check out: https://discord.com/channels/1015729793733492756/1402033799369461951"
		);
	}
}

export default Help;
