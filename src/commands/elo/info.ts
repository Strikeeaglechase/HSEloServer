import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { EmbedBuilder, AutocompleteInteraction } from "discord.js";

import { Application } from "../../application.js";

class Info extends SlashCommand {
	name = "info";
	description = "Displays server information and evasion tactics";

	async autocomplete(interaction: AutocompleteInteraction, app: Application) {
		const entries = await app.serverInfos.get();
		const categories = entries.map(entry => entry.id).sort();
		
		const focusedValue = interaction.options.getFocused(true);
		const filtered = categories.filter(cat => cat.toLowerCase().includes(focusedValue.value.toLowerCase())).slice(0, 25);
		
		await interaction.respond(filtered.map(cat => ({ name: cat, value: cat })));
	}

	async run({ interaction, app }: SlashCommandEvent<Application>, @SArg({}) category: string) {
		// Special case for Season
		if (category.toLowerCase() === "season") {
			const activeSeason = await app.getActiveSeason();
			const seasonEmbed = new EmbedBuilder()
				.setTitle("Current Season")
				.setDescription(`The current season is **${activeSeason.name}**`)
				.setColor(0x5865f2);

			await interaction.reply({ embeds: [seasonEmbed] });
			return;
		}

		// For all other categories, fetch from database
		const info = await app.serverInfos.get(category);
		const embed = new EmbedBuilder()
			.setTitle(category)
			.setColor(0x5865f2);

		if (info?.text) {
			embed.setDescription(info.text);
		} else {
			embed.setDescription(`No ${category} information configured. Use \`/setinfo ${category} <text>\` to set it.`);
		}

		// Create a message to send and then collect user messages
		const sentMessage = await interaction.reply({ embeds: [embed], fetchReply: true });

		// Set up message collector for updates
		const filter = (msg) => msg.author.id === interaction.user.id && msg.channel.id === interaction.channel.id;
		const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

		collector.on("collect", async (msg) => {
			if (msg.content.toLowerCase() === "edit") {
				// User wants to see how to edit this category
				const editEmbed = new EmbedBuilder()
					.setTitle(`Editing ${category}`)
					.setDescription(`To edit this category, an admin should use:\n\`/setinfo ${category} <new_text>\``)
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

export default Info;
