import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { EmbedBuilder } from "discord.js";

import { Application } from "../../application.js";

enum InfoCategory {
	Season = "Season",
	ELO = "ELO",
	MapList = "MapList",
	AircraftList = "AircraftList",
	CFIT = "CFIT",
	GPull = "GPull",
	Notching = "Notching",
	TerrainMask = "Terrain Mask",
	Cranking = "Cranking",
	Intercept = "Intercept"
}

const infoCategories = [
	{ name: InfoCategory.Season, value: InfoCategory.Season },
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

class Info extends SlashCommand {
	name = "info";
	description = "Displays server information and evasion tactics";

	async run(
		{ interaction, app }: SlashCommandEvent<Application>,
		@SArg({ choices: infoCategories }) category: string
	) {
		switch (category) {
		case InfoCategory.Season:
			const activeSeason = app.getActiveSeason();
			const seasonEmbed = new EmbedBuilder()
				.setTitle("Current Season")
				.setDescription(`The current season is **${activeSeason}**`)
				.setColor(0x5865F2);

			await interaction.reply({ embeds: [seasonEmbed] });
			break;

		case InfoCategory.ELO:
			const eloInfo = await app.serverInfos.get("ELO");
			const eloEmbed = new EmbedBuilder()
				.setTitle("ELO System")
				.setColor(0x5865F2);

			if (eloInfo?.text) {
				eloEmbed.setDescription(eloInfo.text);
			} else {
				eloEmbed.setDescription("No ELO information configured. Use `/setinfo ELO <text>` to set it.");
			}

			await interaction.reply({ embeds: [eloEmbed] });
			break;

		case InfoCategory.MapList:
			const mapListInfo = await app.serverInfos.get("MapList");
			const mapListEmbed = new EmbedBuilder()
				.setTitle("Map List")
				.setColor(0x5865F2);

			if (mapListInfo?.text) {
				mapListEmbed.setDescription(mapListInfo.text);
			} else {
				mapListEmbed.setDescription("No map list configured. Use `/setinfo MapList <text>` to set it.");
			}

			await interaction.reply({ embeds: [mapListEmbed] });
			break;

		case InfoCategory.AircraftList:
			const aircraftListInfo = await app.serverInfos.get("AircraftList");
			const aircraftListEmbed = new EmbedBuilder()
				.setTitle("Aircraft List")
				.setColor(0x5865F2);

			if (aircraftListInfo?.text) {
				aircraftListEmbed.setDescription(aircraftListInfo.text);
			} else {
				aircraftListEmbed.setDescription("No aircraft list configured. Use `/setinfo AircraftList <text>` to set it.");
			}

			await interaction.reply({ embeds: [aircraftListEmbed] });
			break;

		case InfoCategory.CFIT:
			const cfitInfo = await app.serverInfos.get("CFIT");
			const cfitEmbed = new EmbedBuilder()
				.setTitle("CFIT (Controlled Flight Into Terrain)")
				.setColor(0x5865F2);

			if (cfitInfo?.text) {
				cfitEmbed.setDescription(cfitInfo.text);
			} else {
				cfitEmbed.setDescription("No CFIT information configured. Use `/setinfo CFIT <text>` to set it.");
			}

			await interaction.reply({ embeds: [cfitEmbed] });
			break;

		case InfoCategory.GPull:
			const gPullInfo = await app.serverInfos.get("GPull");
			const gPullEmbed = new EmbedBuilder()
				.setTitle("G-Pull Evasion")
				.setColor(0x5865F2);

			if (gPullInfo?.text) {
				gPullEmbed.setDescription(gPullInfo.text);
			} else {
				gPullEmbed.setDescription("No G-Pull information configured. Use `/setinfo GPull <text>` to set it.");
			}

			await interaction.reply({ embeds: [gPullEmbed] });
			break;

		case InfoCategory.Notching:
			const notchingInfo = await app.serverInfos.get("Notching");
			const notchingEmbed = new EmbedBuilder()
				.setTitle("Notching Evasion")
				.setColor(0x5865F2);

			if (notchingInfo?.text) {
				notchingEmbed.setDescription(notchingInfo.text);
			} else {
				notchingEmbed.setDescription("No Notching information configured. Use `/setinfo Notching <text>` to set it.");
			}

			await interaction.reply({ embeds: [notchingEmbed] });
			break;

		case InfoCategory.TerrainMask:
			const terrainMaskInfo = await app.serverInfos.get("TerrainMask");
			const terrainMaskEmbed = new EmbedBuilder()
				.setTitle("Terrain Mask Evasion")
				.setColor(0x5865F2);

			if (terrainMaskInfo?.text) {
				terrainMaskEmbed.setDescription(terrainMaskInfo.text);
			} else {
				terrainMaskEmbed.setDescription("No Terrain Mask information configured. Use `/setinfo TerrainMask <text>` to set it.");
			}

			await interaction.reply({ embeds: [terrainMaskEmbed] });
			break;

		case InfoCategory.Cranking:
			const crankingInfo = await app.serverInfos.get("Cranking");
			const crankingEmbed = new EmbedBuilder()
				.setTitle("Cranking Evasion")
				.setColor(0x5865F2);

			if (crankingInfo?.text) {
				crankingEmbed.setDescription(crankingInfo.text);
			} else {
				crankingEmbed.setDescription("No Cranking information configured. Use `/setinfo Cranking <text>` to set it.");
			}

			await interaction.reply({ embeds: [crankingEmbed] });
			break;

		case InfoCategory.Intercept:
			const interceptInfo = await app.serverInfos.get("Intercept");
			const interceptEmbed = new EmbedBuilder()
				.setTitle("Intercept Evasion")
				.setColor(0x5865F2);

			if (interceptInfo?.text) {
				interceptEmbed.setDescription(interceptInfo.text);
			} else {
				interceptEmbed.setDescription("No Intercept information configured. Use `/setinfo Intercept <text>` to set it.");
			}

			await interaction.reply({ embeds: [interceptEmbed] });
			break;
		}
	}
}

export default Info;
