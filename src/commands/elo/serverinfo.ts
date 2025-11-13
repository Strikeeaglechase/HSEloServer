import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";

export enum ServerInfoOptionType {
  Season = "season",
  ELO = "elo",
  MapList = "maplist",
  AircraftList = "aircraftlist",
  CFIT = "cfit",
}

class ServerInfo extends SlashCommand {
  name = "serverinfo";
  description = "Displays server info (season, elo, maplist, aircraftlist)";

  async run(
    { interaction, framework, app }: SlashCommandEvent<Application>,
    @SArg({ required: false }) option?: string
  ) {
    await interaction.deferReply();

    if (!option) {
      await interaction.editReply(
        framework.success(
          "Server Info: use `season`, `elo`, `maplist`, or `aircraftlist` as an argument."
        )
      );
      return;
    }

    switch (option.toLowerCase()) {
      case ServerInfoOptionType.Season:
        await interaction.editReply(framework.success("Current season: (Season 5)"));
        break;
      case ServerInfoOptionType.ELO:
        await interaction.editReply(
          "Factors That Affect Elo:\n" +
            "- Your current Elo\n" +
            "- Target's Elo (elo difference between players)\n" +
            "- Aircraft type (4th gen, 5th gen)\n" +
            "- Weapon used (individual multipliers based on weapon type)\n\n" +
            "Base Kill Value:\n" +
            "- Standard kill: 10 Elo (AIM-120, 4th vs 4th gen, 26 vs 26)\n" +
            "- Gun kill multiplier: ×7.1 (because gun kills are 7.1× rarer than an AIM-120C)\n" +
            "- Example: If both players are 2000 Elo → gun kill = 10 × 7.1 = 71 Elo\n\n" +
            "Elo Gain/Loss Scaling:\n" +
            "- More Elo than target → less gain\n" +
            "- Less Elo than target → more gain\n" +
            "- Minimum: 1 × weapon multiplier\n" +
            "- Maximum: 150 Elo\n\n" +
            "Aircraft Modifiers:\n" +
            "T-55   →  +50% per kill, −10% per death\n" +
            "AV-42  → +50% per kill, −50% per death\n" +
            "EF-24  → −10% per death\n\n" +
            "Weapon Multipliers:\n" +
            "- Rare kills = higher multiplier\n" +
            "- Check current values in #scoreboard"
        );
        break;
      case ServerInfoOptionType.MapList:
        await interaction.editReply(
          "- George\n" +
            "- Crack\n" +
            "- AfMtnsHills\n" +
            "- MtnLakes\n" +
            "- Archipel\n" +
            "- Hmap2\n" +
            "- Fyord2\n" +
            "- Pillars\n" +
            "- Oxicem"
        );
        break;
      case ServerInfoOptionType.AircraftList:
        await interaction.editReply(
          "Total player slots: 8 vs 8\n\n" +
            "Useable Aircraft per team:\n" +
            "- EF-24G (Two slots)\n" +
            "- F-45A (One slot)\n" +
            "- T-55 (Three slots)\n" +
            "- F/A-26B (Eight slots)\n" +
            "- AV-42C (One slot)"
        );
        break;
      case ServerInfoOptionType.CFIT:
        await interaction.editReply(
          "The amount of elo you gain or lose depends on the distance between the crashed plane and the nearest opponent. The elo transfer is treated like a normal weapon kill. The weapon equivalence follows this rule:\n" +
            "If the crash is within 1nm, it's a Gun kill\n" +
            "If the crash is within 5nm, it's an AIM7 kill (LowTechRadar)\n" +
            "If the crash is within 10nm, it's a AIM9 kill (HighTechIR)\n" +
            "If the crash is within 20nm, it's a AIM120 kill (HighTechRadar)\n" +
            "If the crash is beyond 20nm, no CFIT kill is granted and no elo is transferred\n\n" +
            "The weapon equivalence defines the base amount of elo transferred (as presented in ⁠scoreboard ). Then you add to it the usual elo multiplier based on the elo delta between the two players involved, just like you would for a weapon kill.\n\n" +
            "It is important to note that if you've received weapon damages prior to a CFIT, you will be granted a death to this weapon, no matter how far away you CFITed."
        );
        break;
      default:
        await interaction.editReply(
          framework.error("Unknown option. Use: season, elo, maplist, aircraftlist")
        );
        break;
    }
  }
}

export default ServerInfo;
