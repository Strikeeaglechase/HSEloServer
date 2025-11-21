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
			helpEmbed.setDescription("No help information configured. Use `/sethelp` to set it.");
		}

		// Create a message to send and then collect user messages
		const sentMessage = await interaction.reply({ embeds: [helpEmbed], fetchReply: true });

		// Set up message collector for updates
		const filter = (msg) => msg.author.id === interaction.user.id && msg.channel.id === interaction.channel.id;
		const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

		collector.on("collect", async (msg) => {
			if (msg.content.toLowerCase() === "edit") {
				// User wants to see how to edit this
				const editEmbed = new EmbedBuilder()
					.setTitle("Editing Help")
					.setDescription("To edit the help text, an admin should use:\n`/sethelp`")
					.setColor(0x5865f2);
				
				await sentMessage.reply({ embeds: [editEmbed] });
			}
			msg.delete().catch(() => {});
		});

		collector.on("end", () => {
			// Collector timeout - no further action needed
		});
	}
}

export default Help;
