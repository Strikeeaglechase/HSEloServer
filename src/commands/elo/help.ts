import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { EmbedBuilder } from "discord.js";

import { Application } from "../../application.js";

class Help extends SlashCommand {
	name = "help";
	description = "Displays help information";

	@NoArgs
	async run({ interaction, app }: SlashCommandEvent<Application>) {
		const helpInfo = await app.serverInfos.get("Help");
		const helpEmbed = new EmbedBuilder().setTitle("Help").setColor(0x5865f2);

		if (helpInfo?.text) {
			helpEmbed.setDescription(helpInfo.text);
		} else {
			helpEmbed.setDescription("No help information configured. Use `/sethelp <text>` to set it.");
		}

		await interaction.reply({ embeds: [helpEmbed] });
	}
}

export default Help;
