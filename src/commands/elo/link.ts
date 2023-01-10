import { Arg, CommandRun } from "strike-discord-framework/dist/argumentParser.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

const nums = "0123456789";

class Link extends Command {
	name = "link";
	altNames = [];
	allowDm = false;
	help = {
		msg: "Links your discord account to your steam",
		usage: "<steamid>",
	};

	@CommandRun
	async run({ message, framework, app }: CommandEvent<Application>, @Arg({ optional: false }) steamId: string) {
		// Check steamid is numeric
		const isNumeric = steamId.split("").every(c => nums.includes(c));
		if (!isNumeric) return framework.error(`Please provide your steamID64 (https://steamid.io/lookup/${steamId})`);

		// Check existing
		const existing = await app.users.collection.findOne({ discordId: message.author.id });
		if (existing) return framework.error(`You are already linked to ${existing.pilotNames[0]} (${existing.id})`);

		// Check steamid exists
		const user = await app.users.get(steamId);
		if (!user) return framework.error(`That steamID does not exist (connect to the server at least once)`);

		// Check steamid is not linked
		if (user.discordId) return framework.error(`That steamID is already linked to a discord account`);

		// Link
		user.discordId = message.author.id;
		await app.users.update(user, user.id);

		return framework.success(`You are now linked to ${user.pilotNames[0]} (${user.id})`);
	}
}

export default Link;