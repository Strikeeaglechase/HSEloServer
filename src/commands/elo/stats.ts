import Discord, { MessageAttachment } from "discord.js";
import { Arg, CommandRun } from "strike-discord-framework/dist/argumentParser.js";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { ENDPOINT_BASE, getHost } from "../../api.js";
import { Application } from "../../application.js";
import { shouldKillBeCounted } from "../../eloUpdater.js";
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
		usage: "<userid/name> <season #>",
	};

	@CommandRun
	async run({ message, framework, app }: CommandEvent<Application>, @Arg({ optional: true }) userLookup: string, @Arg({ optional: true }) seasonResolver: number) {
		let user: User;
		if (userLookup) {
			user = await lookupUser(app.users, userLookup);
			if (!user) return framework.error(`Could not find a user with that id/name`);
		} else {
			const linkedUser = await app.users.collection.findOne({ discordId: message.author.id });
			if (!linkedUser) return framework.error(`You must be linked to a steam account to use this command without an argument. \`,link <steamid>\``);
			user = linkedUser;
		}

		const activeSeason = await app.getActiveSeason();
		let targetSeason = activeSeason;
		if (seasonResolver) {
			targetSeason = await app.getSeason(seasonResolver);
			if (!targetSeason) return framework.error(`Could not find that season`);
		}

		const timeOnServer = calculateTimeOnServer(user);
		let kills = await app.kills.collection.find({ "killer.ownerId": user.id, season: targetSeason.id }).toArray();
		let deaths = await app.kills.collection.find({ "victim.ownerId": user.id, season: targetSeason.id }).toArray();
		kills = kills.filter(k => shouldKillBeCounted(k));
		deaths = deaths.filter(k => shouldKillBeCounted(k));

		const aircraftMetrics = [Aircraft.FA26b, Aircraft.F45A];
		let killsWith = ``;
		let killsAgainst = ``;
		let deathsAgainst = ``;

		aircraftMetrics.forEach(ac => {
			const killsWithAc = kills.filter(k => k.killer.type == ac);
			const killsAgainstAc = kills.filter(k => k.victim.type == ac);
			const deathsAgainstAc = deaths.filter(k => k.killer.type == ac);

			killsWith += `${Aircraft[ac]}: ${killsWithAc.length}\n`;
			killsAgainst += `${Aircraft[ac]}: ${killsAgainstAc.length}\n`;
			deathsAgainst += `${Aircraft[ac]}: ${deathsAgainstAc.length}\n`;
		});

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

		const rawRank = app.getUserRank(user, targetSeason);
		const rank = rawRank == "N/A" ? 0 : rawRank;
		const playersWithRank = targetSeason.active ? app.getRankedUsers().length : targetSeason.totalRankedUsers;

		const embed = new Discord.MessageEmbed();
		embed.setTitle(`Stats for ${user.pilotNames[0]}`);
		embed.addFields([
			{ name: "Metrics", value: `ELO: ${Math.floor(user.elo)}\nRank: ${rank || "No rank"}\nTop ${(rank / playersWithRank * 100).toFixed(0)}%`, inline: true },
			{ name: "KDR", value: `K: ${kills.length} \nD: ${deaths.length} \nR: ${(kills.length / deaths.length).toFixed(2)}`, inline: true },
			// { name: "Online time", value: `${(timeOnServer / 1000 / 60 / 60).toFixed(2)} hours`, inline: true },
			{ name: "Last Online", value: `<t:${Math.floor(user.loginTimes[user.loginTimes.length - 1] / 1000)}:R>`, inline: true },
			{ name: "Kills with", value: killsWith, inline: true },
			{ name: "Kills against", value: killsAgainst, inline: true },
			{ name: "Deaths against", value: deathsAgainst, inline: true },
			{ name: "Weapons", value: weaponKillsStr || "<No Data>", inline: true },
			{ name: "Died to", value: weaponDeathsStr || "<No Data>", inline: true },
			// { name: "Kills per hour", value: `${(user.kills / (timeOnServer / 1000 / 60 / 60)).toFixed(2)}`, inline: true },
		]);
		embed.setFooter({ text: `${targetSeason.name} | ID: ${user.id}` });

		let files: Discord.MessageAttachment[] = [];
		if (targetSeason.active) {
			const path = await createUserEloGraph(user);
			console.log(path);
			const host = getHost();
			embed.setImage(`${host}${ENDPOINT_BASE}public/graph/${user.id}/${Math.floor(Math.random() * 1000)}`);
			const attachment = new Discord.MessageAttachment(app.elo.getUserLog(user.id), "history.txt");
			files = [attachment];
		}

		message.channel.send({ embeds: [embed], files: files });
	}
}

export default Stats;