import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";

enum EvasionConditionType {
	GPull = "GPull",
	Notching = "Notching",
	TerrainMask = "Terrain Mask",
	Cranking = "Cranking",
	Intercept = "Intercept"
}

const evasionConditions = [
	{ name: EvasionConditionType.GPull, value: EvasionConditionType.GPull },
	{ name: EvasionConditionType.Notching, value: EvasionConditionType.Notching },
	{ name: EvasionConditionType.TerrainMask, value: EvasionConditionType.TerrainMask },
	{ name: EvasionConditionType.Cranking, value: EvasionConditionType.Cranking },
	{ name: EvasionConditionType.Intercept, value: EvasionConditionType.Intercept }
];

class Evasion extends SlashCommand {
	name = "evasion";
	description = "Displays evasion tactics information";

	async run(
		
		{ interaction }: SlashCommandEvent<Application>,
		@SArg({ choices: evasionConditions }) condition: string
	) {
		switch (condition) {
			case EvasionConditionType.GPull:
				await interaction.reply(
					"G-pulling is the method of pulling more Gs than radar guided missiles are capable of pulling. AIM-120Cs require ~10Gs to beat, AIM-120Ds, require ~11Gs, AIM-7s and AIM-54s both require ~9Gs.\n\nFor 4th generation aircraft, disabling G-limit and a brief aggressive input on the stick can bring you to 13-14Gs momentarily, which when timed right will allow you to evade incoming radar guided missiles\n\nFor 5th generation aircraft, you need to offset the missile to the left or right of the aircraft, input full rudder deflection to the side the missile is on, and roll/climb over and around the missile in a spiral to achieve the Gs needed."
				);
				break;

			case EvasionConditionType.Notching:
				await interaction.reply(
					"Notching is the act of placing your aircraft perpendicular to the radar source (missile or aircraft) STT locking you, and dropping chaff while in this position. The radar will attempt to lock the chaff instead of you, defeating the missile.\n\nNotching is much easier when you are below the radar that is locking you is above you, as radars have a strength debuff when looking down."
				);
				break;

			case EvasionConditionType.TerrainMask:
				await interaction.reply("Terrain mask is the act of absuing the missiles guidance by maneuvering your aircraft in a way that drives the missile into the ground, or simply by breaking line of sight with the missile with terrain.");
				break;

			case EvasionConditionType.Cranking:
				await interaction.reply(
					"Cranking is the act of turning your aircraft as far as possible (left or right) while still maintaining a radar lock to guide your missile. The intended function of this is to give the enemy missile a longer distance to travel than yours, resulting in the missile having less energy on arrival.\n\nIn practice, due to VTOL's current missile phsyics, this is not considered viable."
				);
				break;

			case EvasionConditionType.Intercept:
				await interaction.reply("Intercept: Aggressive positioning to engage incoming threats.");
				break;
		}
	}
}

export default Evasion;
