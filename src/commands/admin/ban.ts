import Discord from "discord.js";
import { Arg, CommandRun } from "strike-discord-framework/dist/argumentParser.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

class Ban extends Command {
	name = "ban";
	allowDm = false;
	help = {
		msg: "Bans a user"
	};

	@CommandRun
	async run({ message, framework, app }: CommandEvent<Application>, @Arg({}) userId: string) {
		let user = await app.users.get(userId);
		if (!user) user = await app.createNewUser(userId);

		user.isBanned = true;
		await app.users.update(user, user.id);

		return framework.success(`Banned ${user.pilotNames[0] ?? user.id}`);
	}
}

export default Ban;
