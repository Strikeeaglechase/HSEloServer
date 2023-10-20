import Discord from "discord.js";
import { Arg, CommandRun } from "strike-discord-framework/dist/argumentParser.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

class Kick extends Command {
	name = "kick";
	allowDm = true;
	help = {
		msg: "Kicks a user thats currently on the server"
	};

	@CommandRun
	async run({ message, framework, app }: CommandEvent<Application>, @Arg({}) userId: string) {
		app.api.sendKickUserRequest(userId);

		return framework.success(`Sent kick request for user ${userId}`);
	}
}

export default Kick;
