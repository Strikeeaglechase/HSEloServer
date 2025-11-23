import { SlashCommand, SlashCommandEvent, SlashCommandAutocompleteEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { EmbedBuilder } from "discord.js";

import { Application } from "../../application.js";

class Info extends SlashCommand {
	name = "info";
	description = "Displays server information and evasion tactics";

	async handleAutocomplete(event: SlashCommandAutocompleteEvent<Application>) {
		try {
			const interaction = event.interaction;
			const app = event.app;
			const entries = await app.serverInfos.get();
			const categories = ["Season", ...entries.map(entry => entry.id)].sort();
			
			const focusedValue = interaction.options.getFocused(true);
			const filtered = categories.filter(cat => cat.toLowerCase().includes(focusedValue.value.toLowerCase())).slice(0, 25);
			
			await interaction.respond(filtered.map(cat => ({ name: cat, value: cat })));
		} catch (error) {
			event.app.log.error(`Autocomplete error in info command: ${error}`);
			await event.interaction.respond([]);
		}
	}

	async run({ interaction, app }: SlashCommandEvent<Application>, @SArg({ autocomplete: true }) category: string) {
		if (category.toLowerCase() === "season") {
			const activeSeason = await app.getActiveSeason();
			const seasonEmbed = new EmbedBuilder()
				.setTitle("Current Season")
				.setDescription(`The current season is **${activeSeason.name}**`)
				.setColor(0x5865f2);

			await interaction.reply({ embeds: [seasonEmbed] });
			return;
		}

		const info = await app.serverInfos.get(category);
		const embed = new EmbedBuilder()
			.setTitle(category)
			.setColor(0x5865f2);

		if (info?.text) {
			embed.setDescription(info.text);
		} else {
			embed.setDescription(`No ${category} information configured. Use \`/setinfo ${category} <text>\` to set it.`);
		}

		await interaction.reply({ embeds: [embed] });
	}
}

export default Info;
