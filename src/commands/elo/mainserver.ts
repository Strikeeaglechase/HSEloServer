import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs, SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";

class MainServer extends SlashCommand {
  name = "mainserver";
  description = "Main server command placeholder";

  @NoArgs
  async run({ interaction, framework, app }: SlashCommandEvent<Application>) {
    await interaction.reply("https://discord.gg/boundlessdynamics");
  }
}

export default MainServer;
