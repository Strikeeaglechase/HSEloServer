import Discord from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { ENDPOINT_BASE, getHost } from "../../api.js";
import { achievementsEnabled, Application } from "../../application.js";
import { shouldKillBeCounted } from "../../elo/eloUpdater.js";
import { resolveUser, resolveSeason } from "../../userUtils.js";
import { createUserEloGraph } from "../../graph/graph.js";
import { Aircraft, EndOfSeasonStats, Kill, MissileLaunchParams, Season, User, Weapon } from "../../structures.js";

const expectedMaxTimeOnServer = 1000 * 60 * 60 * 1.1; // 1.1 hours
const aircraftWithMetrics = [Aircraft.FA26b, Aircraft.F45A, Aircraft.T55, Aircraft.EF24G, Aircraft.AV42c];

function getStatsBlockForAircraft(aircraft: Aircraft, kills: Kill[], deaths: Kill[], missileLaunches: MissileLaunchParams[]) {
	if (kills.length === 0) return null;

	const kdr = deaths.length === 0 ? kills.length : kills.length / deaths.length;

	const weaponKills: Record<Weapon, number> = {} as Record<Weapon, number>;
	kills.forEach(k => {
		weaponKills[k.weapon] = (weaponKills[k.weapon] ?? 0) + 1;
	});

	const weaponKillsStr = Object.entries(weaponKills)
		.sort((a, b) => b[1] - a[1])
		.map(entry => `${entry[1]} ${Weapon[entry[0]]}`)
		.join("\n");

	return `Total Kills: ${kills.length}\nKDR: ${kdr.toFixed(2)}\n*__Weapon Kills__*\n${weaponKillsStr}`;
}

function getFirstOnline(user: User): string {
	const loginTimes = Array.isArray(user.loginTimes) ? user.loginTimes.filter(t => typeof t === "number" && Number.isFinite(t) && t > 0) : [];
	const sessionTimes = Array.isArray(user.sessions)
		? user.sessions.map(s => s.startTime).filter(t => typeof t === "number" && Number.isFinite(t) && t > 0)
		: [];
	const allTimes = [...loginTimes, ...sessionTimes];
	if (allTimes.length === 0) return "Never";
	return new Date(Math.min(...allTimes)).toLocaleDateString();
}

async function getMostInteractedWith(kills: Kill[], app: Application, mode: "killer" | "victim") {
	// Count kills per victim
	const killsPerVictim: Record<string, number> = {};
	let largestCountId = null;
	let largestCount = 0;

	kills.forEach(kill => {
		const targetId = mode == "killer" ? kill.killer.ownerId : kill.victim.ownerId;
		killsPerVictim[targetId] = (killsPerVictim[targetId] ?? 0) + 1;

		if (killsPerVictim[targetId] > largestCount) {
			largestCount = killsPerVictim[targetId];
			largestCountId = targetId;
		}
	});

	if (!largestCountId) return null;

	const targetUser = await app.users.get(largestCountId);
	return { name: targetUser?.pilotNames[0] ?? "Unknown", count: largestCount };
}

function getStreakStats(kills: Kill[], deaths: Kill[]) {
	const events = [...kills.map(k => ({ type: "kill", time: k.time })), ...deaths.map(d => ({ type: "death", time: d.time }))].sort((a, b) => a.time - b.time);

	let currentKillStreak = 0;
	let longestKillStreak = 0;
	let currentDeathStreak = 0;
	let longestDeathStreak = 0;

	for (const event of events) {
		if (event.type === "kill") {
			currentKillStreak++;
			if (currentKillStreak > longestKillStreak) longestKillStreak = currentKillStreak;
			currentDeathStreak = 0;
		} else if (event.type === "death") {
			currentDeathStreak++;
			if (currentDeathStreak > longestDeathStreak) longestDeathStreak = currentDeathStreak;
			currentKillStreak = 0;
		}
	}

	return {
		longestKillStreak,
		longestDeathStreak
	};
}

function getValidSessions(user: User, season: Season) {
	if (!user.sessions || user.sessions.length === 0) return [];

	const seasonStartTime = new Date(season.started).getTime();
	const seasonEndTime = season.active ? Infinity : new Date(season.ended).getTime();

	return user.sessions.filter(s => {
		if (typeof s.startTime !== "number" || typeof s.endTime !== "number" || s.endTime <= s.startTime) {
			return false;
		}

		const sessionLength = s.endTime - s.startTime;
		if (sessionLength > expectedMaxTimeOnServer) return false;

		return s.startTime < seasonEndTime && s.endTime > seasonStartTime;
	});
}

function getTimeOnline(user: User, season: Season) {
	return getValidSessions(user, season)
		.map(s => s.endTime - s.startTime)
		.reduce((a, b) => a + b, 0);
}

async function getSteamAvatar(userId: string) {
	try {
		const steamApiKey = process.env.STEAM_API_KEY;
		if (!steamApiKey) {
			throw new Error("STEAM_API_KEY is not set in environment variables.");
		}
		const steamApiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamApiKey}&steamids=${userId}`;
		const response = await fetch(steamApiUrl);
		const data = await response.json();
		// console.log("Steam API response data:", data);
		const avatarUrl = (data as any).response?.players?.[0]?.avatarfull;
		return avatarUrl || null;
	} catch (err) {
		// console.warn("Could not fetch Steam avatar:", err);
		return null;
	}
}

async function getAchievementStats(user: User, app: Application, targetSeason: Season, endOfSeasonStats: EndOfSeasonStats) {
	let achievementLogText = "";
	if (!achievementsEnabled || (!targetSeason.active && !endOfSeasonStats)) return { achievementsStr: "", achievementLogText: "" };

	const userAchievements = targetSeason.active ? user.achievements : endOfSeasonStats.achievements ?? [];
	const achievements = userAchievements.map(userAchInfo => app.achievementManager.getAchievement(userAchInfo.id)).filter(ach => ach != null).sort();
	const dbAchievements = await Promise.all(
		achievements.map(ach => {
			if (targetSeason.active) return app.achievementsDb.get(ach.id);
			return targetSeason.endStats.achievementHistory.find(a => a.id == ach.id);
		})
	);
	const topAchievements = dbAchievements.filter(a => a != null).sort((a, b) => {
		if (a.firstAchievedBy == user.id) return -1;
		const aCount = a.users.length;
		const bCount = b.users.length;
		return bCount - aCount;
	});

	achievementLogText += `\n\n\nAchievement log:\n`;
	topAchievements.forEach(dbAchievement => {
		const achievement = achievements.find(a => a.id == dbAchievement.id);
		const userAchievement = userAchievements.find(a => a.id == dbAchievement.id);
		if (!achievement) {
			console.log(`Achievement ${dbAchievement.id} was not found in the achievement list`);
			console.log(`Achievement list: ${achievements.map(a => a?.id).join(", ")}`);
		}

		if (!userAchievement) {
			console.log(`UserAchievement ${dbAchievement.id} was not found in the userAchievements list`);
			console.log(`UserAchievements list: ${userAchievements.map(a => a?.id).join(", ")}`);
		}

		achievementLogText += `${achievement.name} x${userAchievement.count} \n`;
		achievementLogText += `${achievement.description} \n`;
		achievementLogText += `First achieved on ${new Date(userAchievement.firstAchieved).toISOString()}\n\n`;
	});

	const table: { txt: string; bold: boolean }[][] = [];
	const topSix = topAchievements.slice(0, 6);

	for (let i = 0; i < topSix.length; i += 2) {
		const ach = topSix[i];
		const achievement = achievements.find(a => a.id == ach.id);
		table.push([
			{
				txt: achievement.name,
				bold: ach.firstAchieved && ach.firstAchievedBy == user.id
			}
		]);

		const ach2 = topSix[i + 1];
		if (ach2) {
			const achievement2 = achievements.find(a => a.id == ach2.id);
			table[table.length - 1].push({
				txt: achievement2.name,
				bold: ach2.firstAchieved && ach2.firstAchievedBy == user.id
			});
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

	return {
		achievementsStr,
		achievementLogText
	};
}

class Stats extends SlashCommand {
	name = "stats";
	description = "Gets the stats for yourself or another user";

	async run(
		{ interaction, framework, app }: SlashCommandEvent<Application>,
		@SArg({ required: false }) username: string,
		@SArg({ required: false }) season: number
	) {
		await interaction.deferReply();
		const user = await resolveUser(username, framework, app, interaction);
		if (!user) return;

		const targetSeason = await resolveSeason(season, framework, app, interaction);
		if (!targetSeason) return;

		let kills = await app.kills.collection.find({ "killer.ownerId": user.id, "season": targetSeason.id }).toArray();
		let deaths = await app.kills.collection.find({ "victim.ownerId": user.id, "season": targetSeason.id }).toArray();
		kills = kills.filter(k => shouldKillBeCounted(k));
		deaths = deaths.filter(k => shouldKillBeCounted(k));

		const mostKilled = await getMostInteractedWith(kills, app, "victim");
		const mostDeathsTo = await getMostInteractedWith(deaths, app, "killer");
		const { longestKillStreak, longestDeathStreak } = getStreakStats(kills, deaths);

		let killsWith = ``;
		let killsAgainst = ``;
		let deathsAgainst = ``;

		aircraftWithMetrics.forEach(ac => {
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
			.map(entry => `${entry[1]} ${Weapon[entry[0]]}`)
			.join("\n");
		const weaponDeathsStr = Object.entries(diedToWeapons)
			.sort((a, b) => b[1] - a[1])
			.map(entry => entry[1] + " " + Weapon[entry[0]])
			.join("\n");

		const missileLaunches = await app.missileLaunchParams.collection.find({ "launcher.ownerId": user.id, "season": targetSeason.id }).toArray();

		const endOfSeasonStats = targetSeason.active
			? null
			: await app.endOfSeasonStats.collection.findOne({
					season: targetSeason.id,
					userId: user.id
			  });
		const rawRank = app.getUserRank(user, targetSeason, endOfSeasonStats);
		const rank = rawRank == "N/A" ? 0 : rawRank;
		const elo = targetSeason.active ? user.elo : endOfSeasonStats?.elo ?? 0;
		const playersWithRank = targetSeason.totalRankedUsers;
		const mostRecentSession = user.sessions?.length > 0 ? user.sessions[user.sessions.length - 1] : null;
		const lastOnlineTimeStamp = mostRecentSession ? `<t:${Math.floor((mostRecentSession?.startTime ?? 0) / 1000)}:R>` : "Never";

		const totalOnlineMs = getTimeOnline(user, targetSeason);
		const totalOnlineHours = totalOnlineMs / 1000 / 60 / 60;
		const killsPerHour = kills.length / totalOnlineHours;
		const seasonSessions = getValidSessions(user, targetSeason);
		// const averageSessionLength =

		const aircraftStatsMap: Partial<Record<Aircraft, { kills: Kill[]; deaths: Kill[]; missiles: MissileLaunchParams[] }>> = {};
		aircraftWithMetrics.forEach(ac => {
			aircraftStatsMap[ac] = { kills: [], deaths: [], missiles: [] };
		});

		kills.forEach(k => aircraftStatsMap[k.killer.type].kills.push(k));
		deaths.forEach(d => aircraftStatsMap[d.victim.type].deaths.push(d));
		missileLaunches.forEach(ml => aircraftStatsMap[ml.launcher.type]?.missiles.push(ml));

		let maxElo = 0;
		user.eloHistory.forEach(h => (maxElo = Math.max(maxElo, h.elo)));

		const embed = new Discord.EmbedBuilder();
		embed.setColor(0x0099ff);
		embed.setTitle(`Stats for ${user.pilotNames[0]}`);

		// Steam avatar
		const steamAvatarUrl = await getSteamAvatar(user.id);
		if (steamAvatarUrl) {
			embed.setAuthor({ name: user.pilotNames[0] ?? "Unknown", iconURL: steamAvatarUrl });
		}

		// Compose fields for embed
		const metricsValue = [
			`ELO: ${Math.floor(elo)}`,
			`Rank: ${rank || "No rank"}`,
			`Top: ${((rank / playersWithRank) * 100).toFixed(0)}%`,
			`Peak: ${Math.floor(maxElo)}`,
			`Avg: ${Math.floor(user.eloHistory.reduce((sum, h) => sum + h.elo, 0) / user.eloHistory.length)}`
		].join("\n");

		const kdrValue = `K: ${kills.length} \nD: ${deaths.length} \nR: ${(kills.length / deaths.length).toFixed(2)}`;
		const onlineStatsValue = `First Online: ${getFirstOnline(user)}\nLast Online: ${lastOnlineTimeStamp}\nOnline Time: ${totalOnlineHours.toFixed(2)} hours`;

		const miscStatsValue = [
			`Longest Killstreak: ${longestKillStreak}`,
			`Longest Deathstreak: ${longestDeathStreak}`,
			`Kills/Hr: ${killsPerHour.toFixed(2)}`,
			`Total Sessions: ${seasonSessions.length}`
		].join("\n");

		const vsStatsValue = [
			`Most Kills Against: ${mostKilled?.name ?? "Invalid"} (${mostKilled?.count ?? 0})`,
			`Most Deaths Against: ${mostDeathsTo?.name ?? "Invalid"} (${mostDeathsTo?.count ?? 0})`
		].join("\n");

		const aircraftStatBlocks = aircraftWithMetrics
			.map(ac => {
				const text = getStatsBlockForAircraft(ac, aircraftStatsMap[ac].kills, aircraftStatsMap[ac].deaths, aircraftStatsMap[ac].missiles);
				if (!text) return null;

				return {
					name: `${Aircraft[ac]} Stats`,
					value: text,
					inline: true
				};
			})
			.filter(b => b != null);

		embed.addFields([
			{ name: "Metrics", value: metricsValue, inline: true },
			{ name: "KDR", value: kdrValue, inline: true },
			{ name: "Online Stats", value: onlineStatsValue, inline: true },
			{ name: "Aircraft Kills", value: killsWith || "<No Data>", inline: true },
			{ name: "Weapons", value: weaponKillsStr || "<No Data>", inline: true },
			{ name: "Died to", value: weaponDeathsStr || "<No Data>", inline: true },
			{ name: "Kills against", value: killsAgainst, inline: true },
			{ name: "Deaths against", value: deathsAgainst, inline: true },
			{ name: "Misc. Stats", value: miscStatsValue, inline: true },
			...aircraftStatBlocks,
			{ name: "VS Stats", value: vsStatsValue, inline: true }
		]);

		// Achievements
		const { achievementsStr, achievementLogText } = await getAchievementStats(user, app, targetSeason, endOfSeasonStats);
		if (achievementsStr) embed.setDescription(achievementsStr);

		embed.setFooter({ text: `${targetSeason.name} | ID: ${user.id}` });

		// let files: Discord.MessageAttachment[] = [];
		if (targetSeason.active) {
			const path = await createUserEloGraph(user);
			const host = getHost();
			embed.setImage(`${host}${ENDPOINT_BASE}public/graph/${user.id}/${Math.floor(Math.random() * 1000)}`);
		}
		const attachment = new Discord.AttachmentBuilder(await app.elo.getUserLog(user.id, targetSeason, achievementLogText), { name: "history.txt" });
		const files = [attachment];

		interaction.editReply({ embeds: [embed], files });
	}
}

export default Stats;
