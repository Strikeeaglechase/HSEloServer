import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { admins, Application } from "../../application.js";

enum InfoCategory {
	ELO = "ELO",
	MapList = "MapList",
	AircraftList = "AircraftList",
	CFIT = "CFIT",
	GPull = "GPull",
	Notching = "Notching",
	TerrainMask = "TerrainMask",
	Cranking = "Cranking",
	Intercept = "Intercept"
}

const infoCategories = [
	{ name: InfoCategory.ELO, value: InfoCategory.ELO },
	{ name: InfoCategory.MapList, value: InfoCategory.MapList },
	{ name: InfoCategory.AircraftList, value: InfoCategory.AircraftList },
	{ name: InfoCategory.CFIT, value: InfoCategory.CFIT },
	{ name: InfoCategory.GPull, value: InfoCategory.GPull },
	{ name: InfoCategory.Notching, value: InfoCategory.Notching },
	{ name: InfoCategory.TerrainMask, value: InfoCategory.TerrainMask },
	{ name: InfoCategory.Cranking, value: InfoCategory.Cranking },
	{ name: InfoCategory.Intercept, value: InfoCategory.Intercept }
];

class SetInfo extends SlashCommand {
	name = "setinfo";
	description = "Sets info text for a category";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({ choices: infoCategories }) category: string, @SArg({}) text: string) {
		const allowedRoleIds = [
			"1078735204706963457"
		];

		const member = interaction.guild?.members.cache.get(interaction.user.id);
		const hasAllowedRole = member?.roles.cache.some(role => allowedRoleIds.includes(role.id));

		if (!admins.includes(interaction.user.id) && !hasAllowedRole) {
			await interaction.reply(framework.error("No"));
			return;
		}

		await app.serverInfos.update({ id: category, text: text }, category);

		return framework.success(`Updated ${category} info`);
	}
}

export default SetInfo;
