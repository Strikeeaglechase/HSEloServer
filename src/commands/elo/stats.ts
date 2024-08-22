import Discord from "discord.js";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { ENDPOINT_BASE, getHost } from "../../api.js";
import { achievementsEnabled, Application } from "../../application.js";
import { shouldKillBeCounted } from "../../elo/eloUpdater.js";
import { createUserEloGraph } from "../../graph/graph.js";
import { Aircraft, User, Weapon } from "../../structures.js";

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

class Stats extends SlashCommand {
	name = "stats";
	description = "Gets the stats for yourself or another user";

	async run(
		{ interaction, framework, app }: SlashCommandEvent<Application>,
		@SArg({ required: false }) userName: string,
		@SArg({ required: false }) season: number
	) {
		await interaction.deferReply();
		let user: User;
		if (userName) {
			user = await lookupUser(app.users, userName);
			if (!user) {
				await interaction.editReply(framework.error(`Could not find a user with that id/name`));
				return;
			}
		} else {
			const linkedUser = await app.users.collection.findOne({ discordId: interaction.user.id });
			if (!linkedUser) {
				interaction.editReply(framework.error(`You must be linked to a steam account to use this command without an argument. \`/link <steamid>\``));
				return;
			}
			user = linkedUser;
		}

		const activeSeason = await app.getActiveSeason();
		let targetSeason = activeSeason;
		if (season) {
			targetSeason = await app.getSeason(season);
			if (!targetSeason) {
				interaction.editReply(framework.error(`Could not find that season`));
				return;
			}
		}

		const timeOnServer = calculateTimeOnServer(user);
		let kills = await app.kills.collection.find({ "killer.ownerId": user.id, "season": targetSeason.id }).toArray();
		let deaths = await app.kills.collection.find({ "victim.ownerId": user.id, "season": targetSeason.id }).toArray();
		kills = kills.filter(k => shouldKillBeCounted(k));
		deaths = deaths.filter(k => shouldKillBeCounted(k));

		const aircraftMetrics = [Aircraft.FA26b, Aircraft.F45A, Aircraft.T55, Aircraft.EF24G];
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
		kills.forEach(k => {
			usedWeapons[k.weapon] = (usedWeapons[k.weapon] ?? 0) + 1;
		});
		deaths.forEach(k => {
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

		const endOfSeasonStats = targetSeason.active ? null : await app.endOfSeasonStats.collection.findOne({ season: targetSeason.id, user: user.id });
		const rawRank = app.getUserRank(user, targetSeason, endOfSeasonStats);
		const rank = rawRank == "N/A" ? 0 : rawRank;
		const playersWithRank = targetSeason.totalRankedUsers;
		const mostRecentSession = user.sessions?.length > 0 ? user.sessions[user.sessions.length - 1] : null;
		const lastOnlineTimeStamp = mostRecentSession ? `<t:${Math.floor((mostRecentSession?.startTime ?? 0) / 1000)}:R>` : "Never";

		let maxElo = 0;
		user.eloHistory.forEach(h => (maxElo = Math.max(maxElo, h.elo)));

		const embed = new Discord.EmbedBuilder();
		embed.setTitle(`Stats for ${user.pilotNames[0]}`);
		embed.addFields([
			{
				name: "Metrics",
				value: `ELO: ${Math.floor(user.elo)}\nRank: ${rank || "No rank"}\nTop ${((rank / playersWithRank) * 100).toFixed(0)}%\nPeak: ${Math.floor(maxElo)}`,
				inline: true
			},
			{ name: "KDR", value: `K: ${kills.length} \nD: ${deaths.length} \nR: ${(kills.length / deaths.length).toFixed(2)}`, inline: true },
			// { name: "Online time", value: `${(timeOnServer / 1000 / 60 / 60).toFixed(2)} hours`, inline: true },
			{ name: "Last Online", value: lastOnlineTimeStamp, inline: true },
			{ name: "Kills with", value: killsWith, inline: true },
			{ name: "Kills against", value: killsAgainst, inline: true },
			{ name: "Deaths against", value: deathsAgainst, inline: true },
			{ name: "Weapons", value: weaponKillsStr || "<No Data>", inline: true },
			{ name: "Died to", value: weaponDeathsStr || "<No Data>", inline: true }
			// { name: "Kills per hour", value: `${(user.kills / (timeOnServer / 1000 / 60 / 60)).toFixed(2)}`, inline: true },
		]);

		let achievementLogText = "";
		if (achievementsEnabled) {
			const userAchievements = activeSeason == targetSeason ? user.achievements : endOfSeasonStats?.achievements ?? [];
			const achievements = userAchievements.map(userAchInfo => app.achievementManager.getAchievement(userAchInfo.id)).sort();
			const dbAchievements = await Promise.all(achievements.map(ach => app.achievementsDb.get(ach.id)));
			const topAchievements = dbAchievements.sort((a, b) => {
				if (a.firstAchievedBy == user.id) return -1;
				const aCount = a.users.length;
				const bCount = b.users.length;
				return bCount - aCount;
			});

			achievementLogText += `\n\n\nAchievement log:\n`;
			topAchievements.forEach(dbAchievement => {
				const achievement = achievements.find(a => a.id == dbAchievement.id);
				const userAchievement = user.achievements.find(a => a.id == dbAchievement.id);

				achievementLogText += `${achievement.name} x${userAchievement.count} \n`;
				achievementLogText += `${achievement.description} \n`;
				achievementLogText += `First achieved on ${new Date(userAchievement.firstAchieved).toISOString()}\n\n`;
			});

			const table: { txt: string; bold: boolean }[][] = [];
			const topSix = topAchievements.slice(0, 6);

			for (let i = 0; i < topSix.length; i += 2) {
				const ach = topSix[i];
				const achievement = achievements.find(a => a.id == ach.id);
				table.push([{ txt: achievement.name, bold: ach.firstAchieved && ach.firstAchievedBy == user.id }]);

				const ach2 = topSix[i + 1];
				if (ach2) {
					const achievement2 = achievements.find(a => a.id == ach2.id);
					table[table.length - 1].push({ txt: achievement2.name, bold: ach2.firstAchieved && ach2.firstAchievedBy == user.id });
				}
			}

			let achievementsStr = "```ansi\n[4;2m[1;2mAchievements[0m[0m\n";
			const optBold = (entry: { txt: string; bold: boolean }, pad: number) => {
				if (!entry.bold) return entry.txt.padEnd(pad);
				return `[2;37m[1;37m${entry.txt.padEnd(pad)}[0m[2;37m[0m`;
			};
			const col0Pad = Math.max(...table.map(e => e[0].txt.length)) + 3;
			table.forEach(row => {
				achievementsStr += optBold(row[0], col0Pad);
				if (row[1]) achievementsStr += optBold(row[1], 0);
				achievementsStr += "\n";
			});

			if (topAchievements.length > 5) achievementsStr += `... and ${topAchievements.length - 5} more`;
			achievementsStr += "\n```";
			embed.setDescription(achievementsStr);
		}
		embed.setFooter({ text: `${targetSeason.name} | ID: ${user.id}` });

		// let files: Discord.MessageAttachment[] = [];
		if (targetSeason.active) {
			const path = await createUserEloGraph(user);
			// console.log(path);
			const host = getHost();
			embed.setImage(`${host}${ENDPOINT_BASE}public/graph/${user.id}/${Math.floor(Math.random() * 1000)}`);
		}
		const attachment = new Discord.AttachmentBuilder(await app.elo.getUserLog(user.id, targetSeason, achievementLogText), { name: "history.txt" });
		const files = [attachment];

		interaction.editReply({ embeds: [embed], files });
	}
}

export default Stats;
