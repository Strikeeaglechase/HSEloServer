import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";

enum OptionType {
	SpawncampWarningRadius = "Spawncamp Warning Radius",
	KillSoundEffect = "Kill Sound Effect",
	CustomSuitData = "Custom Suit Data"
}

const options = [
	{ name: OptionType.SpawncampWarningRadius, value: OptionType.SpawncampWarningRadius },
	{ name: OptionType.KillSoundEffect, value: OptionType.KillSoundEffect },
	{ name: OptionType.CustomSuitData, value: OptionType.CustomSuitData }
];

/*
0 = HSKillEffects\bhit_helmet-1.mp3
1 = HSKillEffects\Bonk_Sound_Effect.mp3
2 = HSKillEffects\critical-hit-sounds-effect.mp3
3 = HSKillEffects\halosplash.mp3
4 = HSKillEffects\overwatch-kill-sound.mp3
5 = HSKillEffects\Trident_return3.mp3
6 = HSKillEffects\war-thunder-kill.mp3
*/

const soundEffectNames = ["CS", "Bonk", "TF2", "Splash", "Overwatch", "Trident", "War Thunder"];
const defaultSoundEffect = 4; // Overwatch

function getSoundEffectName(value: number) {
	if (value == -1) return "Disabled";
	if (value < 0 || value > 6) return "Invalid";
	return soundEffectNames[value];
}

class Option extends SlashCommand {
	name = "option";
	description = "Set's a user option";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({ choices: options }) setting: string, @SArg() value: string | number) {
		const user = await app.users.collection.findOne({ discordId: interaction.user.id });
		if (!user) {
			await interaction.reply("You are not linked to a user. Please link your account first.");
			return;
		}

		const num = +value;
		switch (setting) {
			case OptionType.SpawncampWarningRadius:
				if (isNaN(num)) {
					await interaction.reply(framework.error("Spawncamp warning radius must be a number."));
					return;
				}

				interaction.reply(framework.success(`Updated spawncamp warning radius from \`${user.options.spawncampWarnRadius ?? "default"}\` to \`${value}\``));
				user.options.spawncampWarnRadius = num;
				break;

			case OptionType.KillSoundEffect:
				if (isNaN(num)) {
					await interaction.reply(framework.error("Kill sound effect must be a number."));
					return;
				}
				if (num < -1 || num > 6) {
					await interaction.reply(framework.error("Kill sound effect must be between -1 and 6."));
					return;
				}

				const previousSoundEffect = user.options.killSoundEffect ?? defaultSoundEffect;
				// const newSoundEffect =
				interaction.reply(
					framework.success(`Updated kill sound effect from \`${getSoundEffectName(previousSoundEffect)}\` to \`${getSoundEffectName(num)}\``)
				);
				user.options.killSoundEffect = num;
				break;

			case OptionType.CustomSuitData:
				// if (typeof value != "string") {
				// 	await interaction.reply("Custom suit data must be a string.");
				// 	return;
				// }

				interaction.reply(framework.success(`Updated custom suit data from \`${user.options.pilotSuitCustomData ?? "null"}\` to \`${value}\``));
				user.options.pilotSuitCustomData = value.toString();
				break;
		}

		await app.users.collection.updateOne({ discordId: interaction.user.id }, { $set: { options: user.options } });
		app.api.sendNewClientOptions(user.id, user.options);
	}
}

export default Option;
