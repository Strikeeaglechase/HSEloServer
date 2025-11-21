import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { EmbedBuilder } from "discord.js";

import { admins, authRoleIds, Application } from "../../application.js";

class SetHelp extends SlashCommand {
	name = "sethelp";
	description = "Sets help text";

	@NoArgs
	async run({ interaction, framework, app }: SlashCommandEvent<Application>) {
		const member = interaction.guild?.members.cache.get(interaction.user.id);
		const hasAllowedRole = member?.roles.cache.some(role => authRoleIds.includes(role.id));

		if (!admins.includes(interaction.user.id) && !hasAllowedRole) {
			await interaction.reply(framework.error("No"));
			return;
		}

		// Prompt user for text input
		const promptEmbed = new EmbedBuilder()
			.setTitle("Setting Help")
			.setDescription("Please send the new help text content in the next message.")
			.setColor(0x5865f2);

		await interaction.reply({ embeds: [promptEmbed] });

		// Set up message collector for text input
		const filter = (msg) => msg.author.id === interaction.user.id && msg.channel.id === interaction.channel.id;
		const collector = interaction.channel.createMessageCollector({ filter, time: 300000, max: 1 });

		collector.on("collect", async (msg) => {
			const text = msg.content;

			await app.serverInfos.collection.updateOne(
				{ id: "Help" },
				{ $set: { id: "Help", text: text } },
				{ upsert: true }
			);

			const successEmbed = new EmbedBuilder()
				.setTitle("Success")
				.setDescription(`Updated help info with:\n\n${text}`)
				.setColor(0x00ff00);

			await msg.reply({ embeds: [successEmbed] });
			msg.delete().catch(() => {});
		});

		collector.on("end", (collected) => {
			if (collected.size === 0) {
				interaction.channel.send(
					new EmbedBuilder()
						.setTitle("Timeout")
						.setDescription("No message received within 5 minutes. Cancelled.")
						.setColor(0xff0000)
				).catch(() => {});
			}
		});
	}
}

export default SetHelp;
