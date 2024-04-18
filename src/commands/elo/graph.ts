import Discord from "discord.js";
import { Arg, CommandRun } from "strike-discord-framework/dist/argumentParser.js";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { ENDPOINT_BASE, getHost } from "../../api.js";
import { Application } from "../../application.js";
import { createCompareGraph } from "../../graph/graph.js";
import { User } from "../../structures.js";

async function lookupUser(users: CollectionManager<User>, query: string) {
	// SteamID
	const userIdUser = await users.get(query);
	if (userIdUser) return userIdUser;

	// DiscordID
	const discordIdUser = await users.collection.findOne({ discordId: query });
	if (discordIdUser) return discordIdUser;

	console.log(`Doing regex query for ${query}`);
	// PilotName
	const pilotNameUser = await users.collection
		.find({ pilotNames: { $regex: new RegExp(query, "i") } })
		.limit(100)
		.toArray();
	if (pilotNameUser.length > 0) {
		return pilotNameUser.sort((a, b) => b.elo - a.elo)[0];
	}
}

class Graph extends Command {
	name = "graph";
	altNames = [];
	allowDm = false;
	help = {
		msg: "Compares the elo between two users",
		usage: "<userid/name> <userid/name> {stretch/time}"
	};

	@CommandRun
	async run(
		{ message, framework, app }: CommandEvent<Application>,
		@Arg({}) userALookup: string,
		@Arg({}) userBLookup: string,
		@Arg({ optional: true }) mode: "stretch" | "time"
	) {
		const userA = await lookupUser(app.users, userALookup);
		if (!userA) return framework.error(`Could not find a user ${userALookup}`);
		const userB = await lookupUser(app.users, userBLookup);
		if (!userB) return framework.error(`Could not find a user ${userBLookup}`);

		const gid = await createCompareGraph(userA, userB, mode ?? "stretch");
		const host = getHost();
		message.channel.send(`${host}${ENDPOINT_BASE}public/graph/${userA.id}-${userB.id}`);
	}
}

export default Graph;
