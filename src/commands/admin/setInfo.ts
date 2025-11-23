import { SlashCommand, SlashCommandEvent, SlashCommandAutocompleteEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { EmbedBuilder, AutocompleteInteraction } from "discord.js";

import { admins, authRoleIds, Application } from "../../application.js";

class SetInfo extends SlashCommand {
	name = "setinfo";
	description = "Sets info text for a category";

	async handleAutocomplete(event: SlashCommandAutocompleteEvent<Application>) {
		const interaction = event.interaction;
		const app = event.app;
		const entries = await app.serverInfos.get();
		const categories = entries.map(entry => entry.id).sort();
		
		const focusedValue = interaction.options.getFocused(true);
		const filtered = categories.filter(cat => cat.toLowerCase().includes(focusedValue.value.toLowerCase())).slice(0, 25);
		
		await interaction.respond(filtered.map(cat => ({ name: cat, value: cat })));
	}

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({ autocomplete: true }) category: string) {
		const member = interaction.guild?.members.cache.get(interaction.user.id);
		const hasAllowedRole = member?.roles.cache.some(role => authRoleIds.includes(role.id));

		if (!admins.includes(interaction.user.id) && !hasAllowedRole) {
			await interaction.reply(framework.error("No"));
			return;
		}

		const promptEmbed = new EmbedBuilder()
			.setTitle(`Setting ${category}`)
			.setDescription(`Please send the new text content for the **${category}** category in the next message.`)
			.setColor(0x5865f2);

		await interaction.reply({ embeds: [promptEmbed] });

		const filter = (msg) => msg.author.id === interaction.user.id && msg.channel.id === interaction.channel.id;
		const collector = interaction.channel.createMessageCollector({ filter, time: 300000, max: 1 });

		collector.on("collect", async (msg) => {
			const text = msg.content;

			if (text.toLowerCase() === "delete") {
				const result = await app.serverInfos.collection.deleteOne({ id: category });
				
				if (result.deletedCount > 0) {
					const deleteEmbed = new EmbedBuilder()
						.setTitle("Deleted")
						.setDescription(`Successfully deleted the **${category}** category.`)
						.setColor(0xff0000);
					
					await msg.reply({ embeds: [deleteEmbed] });
				} else {
					const notFoundEmbed = new EmbedBuilder()
						.setTitle("Not Found")
						.setDescription(`The **${category}** category does not exist.`)
						.setColor(0xff9900);
					
					await msg.reply({ embeds: [notFoundEmbed] });
				}
			} else {
				await app.serverInfos.collection.updateOne(
					{ id: category },
					{ $set: { id: category, text: text } },
					{ upsert: true }
				);

				const successEmbed = new EmbedBuilder()
					.setTitle("Success")
					.setDescription(`Updated **${category}** info with:\n\n${text}`)
					.setColor(0x00ff00);

				await msg.reply({ embeds: [successEmbed] });
			}
			
			msg.delete().catch(() => {});
		});

		collector.on("end", (collected) => {
			if (collected.size === 0) {
				interaction.channel.send({
					embeds: [
						new EmbedBuilder()
							.setTitle("Timeout")
							.setDescription(`No message received within 5 minutes. Cancelled.`)
							.setColor(0xff0000)
					]
				}).catch(() => {});
			}
		});
	}
}

export default SetInfo;
