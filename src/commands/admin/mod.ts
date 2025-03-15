import Discord, { ActionRowBuilder, ButtonBuilder, ComponentType, MessageActionRowComponentBuilder } from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { admins, Application } from "../../application.js";

class Mod extends SlashCommand {
	name = "mod";
	description = "Looks up a users relevant moderation info and gives option to unban";

	public override async run({ interaction, app, framework }: SlashCommandEvent<Application>, @SArg({}) id: string) {
		const userEntry = await app.users.collection.findOne({ id: id });

		if (!userEntry) {
			await interaction.reply(framework.error(`No record found for user ${id}`, true));
			return;
		}

		interaction.deferReply();
		const embed = await app.createModerationEmbed(userEntry);

		if (admins.includes(interaction.user.id) && userEntry.isBanned) {
			const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				new ButtonBuilder().setCustomId("unban").setLabel("Unban").setStyle(Discord.ButtonStyle.Success)
			);

			const message = await interaction.editReply({ embeds: [embed], components: [row] });

			const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 5 * 60 * 1000 });
			collector.on("collect", async i => {
				if (i.customId != "unban") return;
				if (!admins.includes(i.user.id)) {
					i.reply(framework.error("No", true));
					return;
				}

				await app.users.collection.updateOne({ id: userEntry.id }, { $set: { isBanned: false, teamKills: 0 } });
				i.reply(framework.success(`Unbanned ${userEntry.pilotNames[0] ?? userEntry.id}`, true));

				// Update the embed data but not the message itself, will automatically update the message once the collector ends
				embed.setFooter({ text: `${userEntry.id} | Is banned: ${false}` });
				embed.setColor("Green");
				collector.stop();
			});

			collector.on("end", async () => {
				await message.edit({ embeds: [embed], components: [] });
			});
		} else {
			await interaction.editReply({ embeds: [embed] });
		}
	}
}

export default Mod;
