import { SlashCommand, SlashCommandEvent, SlashCommandAutocompleteEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { EmbedBuilder } from "discord.js";

import { Application } from "../../application.js";

class Help extends SlashCommand {
	name = "help";
	description = "Displays help information";

	async handleAutocomplete(event: SlashCommandAutocompleteEvent<Application>) {
		try {
		const interaction = event.interaction;
		const app = event.app;
		const entries = await app.serverHelps.get();
		const categories = entries.map(entry => entry.id).sort();
		
		const focusedValue = interaction.options.getFocused(true);
		const filtered = categories.filter(cat => cat.toLowerCase().includes(focusedValue.value.toLowerCase())).slice(0, 25);
		
		await interaction.respond(filtered.map(cat => ({ name: cat, value: cat })));
		} catch (error) {
			console.error("Autocomplete error:", error);
			await event.interaction.respond([]);
		}
	}

	async run({ interaction, app }: SlashCommandEvent<Application>, @SArg({ autocomplete: true }) category: string) {
		const helpInfo = await app.serverHelps.get(category);
		const helpEmbed = new EmbedBuilder().setTitle(category).setColor(0x5865f2);

		if (helpInfo?.text) {
			helpEmbed.setDescription(helpInfo.text);
		} else {
			helpEmbed.setDescription(`No ${category} information configured. Use \`/sethelp ${category}\` to set it.`);
		}

		await interaction.reply({ embeds: [helpEmbed] });
	}
}

export default Help;
