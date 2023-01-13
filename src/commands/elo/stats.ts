import Discord, { MessageAttachment } from "discord.js";
import { Arg, CommandRun } from "strike-discord-framework/dist/argumentParser.js";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { ENDPOINT_BASE, getHost } from "../../api.js";
import { Application } from "../../application.js";
import { createUserEloGraph } from "../../graph/graph.js";
import { Aircraft, User, Weapon } from "../../structures.js";

async function lookupUser(users: CollectionManager<string, User>, query: string) {
	// SteamID
	const userIdUser = await users.get(query);
	if (userIdUser) return userIdUser;

	// DiscordID
	const discordIdUser = await users.collection.findOne({ discordId: query });
	if (discordIdUser) return discordIdUser;

	// PilotName
	const pilotNameUser = await users.collection.find({ pilotNames: { $regex: new RegExp(query, "i") } }).toArray();
	if (pilotNameUser.length > 0) {
		return pilotNameUser.sort((a, b) => b.elo - a.elo)[0];
	}
}

const expectedMaxTimeOnServer = 1000 * 60 * 60 * 3; // 3 hours
function calculateTimeOnServer(user: User) {
	let loginIdx = 0;
	let logoutIdx = 0;
	let timeOnServer = 0;
	while (loginIdx < user.loginTimes.length && logoutIdx < user.logoutTimes.length) {
		const login = user.loginTimes[loginIdx];
		const logout = user.logoutTimes[logoutIdx];
		const delta = logout - login;
		if (delta > expectedMaxTimeOnServer) {
			loginIdx++;
		} else {
			timeOnServer += delta;
			loginIdx++;
			logoutIdx++;
		}
	}

	return timeOnServer;
}

class Stats extends Command {
	name = "stats";
	altNames = ["stat"];
	allowDm = false;
	help = {
		msg: "Lists your or anthers stats",
		usage: "<userid/name>",
	};

	@CommandRun
	async run({ message, framework, app }: CommandEvent<Application>, @Arg({ optional: true }) userLookup: string) {
		let user: User;
		if (userLookup) {
			user = await lookupUser(app.users, userLookup);
			if (!user) return framework.error(`Could not find a user with that id/name`);
		} else {
			const linkedUser = await app.users.collection.findOne({ discordId: message.author.id });
			if (!linkedUser) return framework.error(`You must be linked to a steam account to use this command without an argument. \`,link <steamid>\``);
			user = linkedUser;
		}

		const timeOnServer = calculateTimeOnServer(user);
		const kills = await app.kills.collection.find({ killerId: user.id }).toArray();
		const deaths = await app.kills.collection.find({ victimId: user.id }).toArray();

		const f45Kills = kills.filter((k) => k.victimAircraft == Aircraft.F45A);
		const f45Deaths = deaths.filter((k) => k.killerAircraft == Aircraft.F45A);
		const fa26bKills = kills.filter((k) => k.victimAircraft == Aircraft.FA26b);
		const fa26bDeaths = deaths.filter((k) => k.killerAircraft == Aircraft.FA26b);
		const killsUsingF45 = kills.filter((k) => k.killerAircraft == Aircraft.F45A);
		const killsUsingFA26b = kills.filter((k) => k.killerAircraft == Aircraft.FA26b);

		const usedWeapons: Record<Weapon, number> = {} as Record<Weapon, number>;
		const diedToWeapons: Record<Weapon, number> = {} as Record<Weapon, number>;
		kills.forEach((k) => {
			usedWeapons[k.weapon] = (usedWeapons[k.weapon] ?? 0) + 1;
		});
		deaths.forEach((k) => {
			diedToWeapons[k.weapon] = (diedToWeapons[k.weapon] ?? 0) + 1;
		});

		const weaponKillsStr = Object.entries(usedWeapons)
			.sort((a, b) => b[1] - a[1])
			.map(entry => entry[1] + " " + Weapon[entry[0]])
			.join("\n");
		const weaponDeathsStr = Object.entries(diedToWeapons)
			.sort((a, b) => b[1] - a[1])
			.map(entry => entry[1] + " " + Weapon[entry[0]])
			.join("\n");

		const rawRank = app.getUserRank(user);
		const rank = rawRank == "N/A" ? 0 : rawRank;
		const playersWithRank = app.getRankedUsers().length;
		const embed = new Discord.MessageEmbed();
		embed.setTitle(`Stats for ${user.pilotNames[0]}`);
		embed.addFields([
			{ name: "Metrics", value: `ELO: ${Math.floor(user.elo)}\nRank: ${rank || "No rank"}\nTop ${(rank / playersWithRank * 100).toFixed(0)}%`, inline: true },
			{ name: "KDR", value: `K: ${user.kills} \nD: ${user.deaths} \nR: ${(user.kills / user.deaths).toFixed(2)}`, inline: true },
			{ name: "Online time", value: `${(timeOnServer / 1000 / 60 / 60).toFixed(2)} hours`, inline: true },
			{ name: "Kills with", value: `FA-26b: ${killsUsingFA26b.length}\nF-45A: ${killsUsingF45.length}`, inline: true },
			{ name: "Kills against", value: `FA-26b: ${fa26bKills.length}\nF-45A: ${f45Kills.length}`, inline: true },
			{ name: "Deaths against", value: `FA-26b: ${fa26bDeaths.length}\nF-45A: ${f45Deaths.length}`, inline: true },
			{ name: "Weapons", value: weaponKillsStr || "<No Data>", inline: true },
			{ name: "Died to", value: weaponDeathsStr || "<No Data>", inline: true },
			{ name: "Kills per hour", value: `${(user.kills / (timeOnServer / 1000 / 60 / 60)).toFixed(2)}`, inline: true },
		]);
		const path = await createUserEloGraph(user);
		const host = getHost();
		embed.setImage(`${host}${ENDPOINT_BASE}public/graph/${user.id}/${Math.floor(Math.random() * 1000)}`);

		const attachment = new Discord.MessageAttachment(app.elo.getUserLog(user.id), "history.txt");
		message.channel.send({ embeds: [embed], files: [attachment] });
	}
}

export default Stats;