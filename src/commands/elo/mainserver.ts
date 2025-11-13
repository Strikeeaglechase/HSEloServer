import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";

class MainServer extends SlashCommand {
  name = "mainserver";
  description = "Main server command placeholder";

  async run({ interaction, framework, app }: SlashCommandEvent<Application>) {
    await interaction.deferReply();
    await interaction.editReply("https://discord.gg/boundlessdynamics");
  }
}

export default MainServer;
