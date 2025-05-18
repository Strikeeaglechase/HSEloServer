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
	if (query.match(/(https):\/\/steamcommunity\.com\/profiles\/[0-9]+|(http):\/\/steamcommunity\.com\/profiles\/[0-9]+/gim)) {
		const userIdUser = await users.get(query.replace(/(https):\/\/steamcommunity\.com\/profiles\/|(http):\/\/steamcommunity\.com\/profiles\//gim, ""));
		if (userIdUser) return userIdUser;
	} else if (query.match(/[0-9]+/gim)) {
		const userIdUser = await users.get(query);
		if (userIdUser) return userIdUser;
	}

	// DiscordID
	if (query.match(/<@[0-9]+>/gim)) {
		const discordIdUser = await users.collection.findOne({ discordId: query.replace(/<@|>/gim, "") });
		if (discordIdUser) return discordIdUser;
	} else if (query.match(/[0-9]+/gim)) {
		const discordIdUser = await users.collection.findOne({ discordId: query });
		if (discordIdUser) return discordIdUser;
	}

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

function getKillsPerHour(user: User, kills: any[], seasonId: number): string {
    if (!user.sessions || user.sessions.length === 0) return "0.00";
    // Filter sessions to only those in the selected season, if possible
    // This assumes session objects have a 'season' property. If not, remove this filter.
    const seasonSessions = user.sessions.filter(
        (session: any) => session.season === seasonId
    );
    const sessionsToUse = seasonSessions.length > 0 ? seasonSessions : user.sessions;
    const totalOnlineMs = sessionsToUse.reduce((acc, session) => {
        if (session.startTime && session.endTime && session.endTime > session.startTime) {
            return acc + (session.endTime - session.startTime);
        }
        return acc;
    }, 0);
    const totalOnlineHours = totalOnlineMs / 1000 / 60 / 60;
    if (totalOnlineHours === 0) return "0.00";
    return (kills.length / totalOnlineHours).toFixed(2);
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

		// Count kills per victim
		const killsPerVictim: Record<string, number> = {};
		kills.forEach(kill => {
			const victimId = kill.victim.ownerId;
			killsPerVictim[victimId] = (killsPerVictim[victimId] ?? 0) + 1;
		});

		// Most killed victim
		let mostKilledVictimId = null;
		let mostKillsVsVictim = 0;
		for (const [victimId, count] of Object.entries(killsPerVictim)) {
			if (count > mostKillsVsVictim) {
				mostKillsVsVictim = count;
				mostKilledVictimId = victimId;
			}
		}
		// Most deaths vs
		const deathsPerKiller: Record<string, number> = {};
		deaths.forEach(death => {
			const killerId = death.killer.ownerId;
			deathsPerKiller[killerId] = (deathsPerKiller[killerId] ?? 0) + 1;
		});

		let mostDeathsVsId = null;
		let mostDeathsVsCount = 0;
		for (const [killerId, count] of Object.entries(deathsPerKiller)) {
			if (count > mostDeathsVsCount) {
				mostDeathsVsCount = count;
				mostDeathsVsId = killerId;
			}
		}

		let mostDeathsVsName = "";
		if (mostDeathsVsId) {
			const killerUser = await app.users.get(mostDeathsVsId);
			mostDeathsVsName = killerUser ? killerUser.pilotNames[0] : mostDeathsVsId;
		}
		// Victims pilotname (if available)
		let mostEloLost = 0;
		let mostKilledVictimName = "";
		if (mostKilledVictimId) {
			const victimUser = await app.users.get(mostKilledVictimId);
			mostKilledVictimName = victimUser ? victimUser.pilotNames[0] : mostKilledVictimId;
		}

		// Longest killstreak and deathstreak
		const events = [
			...kills.map(k => ({ type: "kill", time: k.time })),
			...deaths.map(d => ({ type: "death", time: d.time }))
		].sort((a, b) => a.time - b.time);
		
		let currentKillStreak = 0;
		let longestKillstreak = 0;
		let currentDeathStreak = 0;
		let longestDeathstreak = 0;
		
		for (const event of events) {
			if (event.type === "kill") {
				currentKillStreak++;
				if (currentKillStreak > longestKillstreak) longestKillstreak = currentKillStreak;
				currentDeathStreak = 0;
			} else if (event.type === "death") {
				currentDeathStreak++;
				if (currentDeathStreak > longestDeathstreak) longestDeathstreak = currentDeathStreak;
				currentKillStreak = 0;
			}
		}
		/*
		//commenting out for now, will fix later
		const missileShots = await app.missiles.collection.find({
			shooterId: user.id,
			season: targetSeason.id
		}).toArray();
		
		const shotsFiredPerMissile: Record<string, number> = {};
		missileShots.forEach(missile => {
			shotsFiredPerMissile[missile.weapon] = (shotsFiredPerMissile[missile.weapon] ?? 0) + 1;
		});
		
		const missileKillsPerWeapon: Record<string, number> = {};
		kills.forEach(kill => {
			if (shotsFiredPerMissile[kill.weapon] !== undefined) {
				missileKillsPerWeapon[kill.weapon] = (missileKillsPerWeapon[kill.weapon] ?? 0) + 1;
			}
		});
		
		const missilePkStats: { weapon: string, pk: number }[] = [];
		for (const weapon of Object.keys(shotsFiredPerMissile)) {
			const shots = shotsFiredPerMissile[weapon];
			const kills = missileKillsPerWeapon[weapon] ?? 0;
			if (shots > 0) {
				missilePkStats.push({ weapon, pk: kills / shots });
			}
		}
		
		let bestMissile: string | null = null;
		let bestPk = -Infinity;
		let worstMissile: string | null = null;
		let worstPk = Infinity;
		
		for (const stat of missilePkStats) {
			if (stat.pk > bestPk) {
				bestPk = stat.pk;
				bestMissile = stat.weapon;
			}
			if (stat.pk < worstPk) {
				worstPk = stat.pk;
				worstMissile = stat.weapon;
			}
		}
		
		const bestMissilePkStr = bestMissile !== null
			? `${bestMissile} (${(bestPk * 100).toFixed(2)}%)`
			: "<No Data>";
		const worstMissilePkStr = worstMissile !== null
			? `${worstMissile} (${(worstPk * 100).toFixed(2)}%)`
			: "<No Data>";		
		
//*/


		 //eloChange logic perhaps working?

const eloGainedFrom: Record<string, number> = {};
const eloLostTo: Record<string, number> = {};

kills.forEach(kill => {
    const victimId = kill.victim.ownerId;
    if (kill && typeof (kill as any).eloChange === "number" && isFinite((kill as any).eloChange)) {
        eloGainedFrom[victimId] = (eloGainedFrom[victimId] ?? 0) + (kill as any).eloChange;
    }
});
deaths.forEach(death => {
    const killerId = death.killer.ownerId;
    if (death && typeof (death as any).eloChange === "number" && isFinite((death as any).eloChange)) {
        eloLostTo[killerId] = (eloLostTo[killerId] ?? 0) + (death as any).eloChange;
    }
});

let mostEloGainedFromId = null;
let mostEloGained = -Infinity;
for (const [id, elo] of Object.entries(eloGainedFrom)) {
    if (elo > mostEloGained && isFinite(elo)) {
        mostEloGained = elo;
        mostEloGainedFromId = id;
    }
}

let mostEloLostToId = null;
let mostEloLostValue = 0;
for (const [id, elo] of Object.entries(eloLostTo)) {
    if (elo < mostEloLostValue && isFinite(elo)) {
        mostEloLostValue = elo;
        mostEloLostToId = id;
    }
}

let mostEloGainedFromName = "";
if (mostEloGainedFromId) {
    const userObj = await app.users.get(mostEloGainedFromId);
    mostEloGainedFromName = userObj ? userObj.pilotNames[0] : mostEloGainedFromId;
}
let mostEloLostToName = "";
if (mostEloLostToId) {
    const userObj = await app.users.get(mostEloLostToId);
    mostEloLostToName = userObj ? userObj.pilotNames[0] : mostEloLostToId;
}

// Prepare lists for embed, filtering out Infinity/NaN
const eloGainedFromList = await Promise.all(
    Object.entries(eloGainedFrom)
        .filter(([_, elo]) => isFinite(elo))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(async ([id, elo]) => {
            const userObj = await app.users.get(id);
            const name = userObj?.pilotNames?.[0] || id;
            return `${name}: ${elo.toFixed(0)}`;
        })
);

const eloLostToList = await Promise.all(
    Object.entries(eloLostTo)
        .filter(([_, elo]) => isFinite(elo))
        .sort((a, b) => a[1] - b[1])
        .slice(0, 5)
        .map(async ([id, elo]) => {
            const userObj = await app.users.get(id);
            const name = userObj?.pilotNames?.[0] || id;
            return `${name}: ${elo.toFixed(0)}`;
        })
);

		const aircraftMetrics = [Aircraft.FA26b, Aircraft.F45A, Aircraft.T55, Aircraft.EF24G, Aircraft.AV42c];
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

		const endOfSeasonStats = targetSeason.active ? null : await app.endOfSeasonStats.collection.findOne({ season: targetSeason.id, userId: user.id });
		const rawRank = app.getUserRank(user, targetSeason, endOfSeasonStats);
		const rank = rawRank == "N/A" ? 0 : rawRank;
		const elo = targetSeason.active ? user.elo : endOfSeasonStats?.elo ?? 0;
		const playersWithRank = targetSeason.totalRankedUsers;
		const mostRecentSession = user.sessions?.length > 0 ? user.sessions[user.sessions.length - 1] : null;
		const lastOnlineTimeStamp = mostRecentSession ? `<t:${Math.floor((mostRecentSession?.startTime ?? 0) / 1000)}:R>` : "Never";

		let totalOnlineMs = 0;
		if (user.sessions && user.sessions.length > 0) {
			totalOnlineMs = user.sessions.reduce((acc, session) => {
				if (session.startTime && session.endTime && session.endTime > session.startTime) {
					return acc + (session.endTime - session.startTime);
				}
				return acc;
			}, 0);
		}
		const totalOnlineHours = (totalOnlineMs / 1000 / 60 / 60).toFixed(2);

		let maxElo = 0;
		user.eloHistory.forEach(h => (maxElo = Math.max(maxElo, h.elo)));

		const embed = new Discord.EmbedBuilder();
		embed.setColor(0x0099ff);
		embed.setTitle(`Stats for ${user.pilotNames[0]}`);
		try {
            const steamApiKey = process.env.STEAM_API_KEY;
            if (!steamApiKey) {
                throw new Error("STEAM_API_KEY is not set in environment variables.");
            }
            const steamApiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamApiKey}&steamids=${user.id}`;
            const response = await fetch(steamApiUrl);
            const data = await response.json();
            console.log("Steam API response data:", data);
            const avatarUrl = data.response?.players?.[0]?.avatarfull;
            if (avatarUrl) {
                embed.setAuthor({ name: user.pilotNames[0], iconURL: avatarUrl });
            }
        } catch (err) {
            console.warn("Could not fetch Steam avatar:", err);
        }
		embed.addFields([
			{ 
			name: "Metrics",
			value: `ELO: ${Math.floor(elo)}
					Rank: ${rank || "No rank"}
					Top: ${((rank / playersWithRank) * 100).toFixed(0)}%
					Peak: ${Math.floor(maxElo)}
					Avg: ${Math.floor(user.eloHistory.reduce((sum, h) => sum + h.elo, 0) / user.eloHistory.length)}`,
					inline: true
			},
			{ name: "KDR", value: `K: ${kills.length} \nD: ${deaths.length} \nR: ${(kills.length / deaths.length).toFixed(2)}`, inline: true },
			{ 
    name: "Online Stats", 
    value: `First Online: ${
        user.sessions && user.sessions.length > 0
            ? new Date(
                user.sessions
                    .map(s => s.startTime)
                    .filter(Boolean)
                    .sort((a, b) => a - b)[0]
              ).toLocaleDateString()
            : "Never"
    }
Last Online: ${lastOnlineTimeStamp}
Online Time: ${totalOnlineHours} hours`,
    inline: true 
},
			//end row 1
			{ name: "Aircraft Kills", value: killsWith || "<No Data>", inline: true },
			{ name: "Weapons", value: weaponKillsStr || "<No Data>", inline: true },
			{ name: "Died to", value: weaponDeathsStr || "<No Data>", inline: true },
			//end row 2
			{ name: "Kills against", value: killsAgainst, inline: true },
			{ name: "Deaths against", value: deathsAgainst, inline: true },
			
			{ 
			name: "Misc. Stats", 
			value: [
				`Longest Killstreak: ${longestKillstreak}`,
				`Longest Deathstreak: ${longestDeathstreak}`,
				`Kills/Hr: ${getKillsPerHour(user, kills, targetSeason.id)}`,
				`Total Sessions: ${user.sessions?.length ?? 0}`,
				(() => {
					if (!user.sessions || user.sessions.length === 0) return "Avg. Session Length: N/A";
					const seasonSessions = user.sessions.filter((session: any) => session.season === targetSeason.id);
					const sessionsToUse = seasonSessions.length > 0 ? seasonSessions : user.sessions;
					const totalMs = sessionsToUse.reduce((acc, session) => {
						if (session.startTime && session.endTime && session.endTime > session.startTime) {
							return acc + (session.endTime - session.startTime);
						}
						return acc;
					}, 0);
					const avgMs = totalMs / sessionsToUse.length;
					const avgMin = avgMs / 1000 / 60;
					return `Avg. Session Length: ${avgMin.toFixed(2)} min`;
				})()
			].join("\n"),
				inline: true 
			},
			// end row 3
			...(
			[
			{ key: "EF-24G", display: "EF-24G Stats" },
			{ key: "T-55", display: "T-55 Stats" },
			{ key: "FA-26B", display: "FA-26B Stats" },
			{ key: "F-45A", display: "F-45A Stats" },
			{ key: "AV-42C", display: "AV-42C Stats" }
			].map(({ key, display }) => {
				const ac = aircraftStats.find(a => a.label === key);
				const totalKills = ac?.weaponKills.reduce((sum, w) => sum + w.count, 0) || 0;
				if (!ac || totalKills === 0) return null;
				return {
			name: display,
					value: `Total Kills: ${totalKills}
				KDR: ${ac.kdr}
				*Weapon Kills*
				${ac.weaponKills.map(w => `${w.count} ${Weapon[w.weapon]}`).join("\n") || "<No Data>"}`,
							inline: true
						};
					}).filter(Boolean)
				),
					{ 
				name: "VS Stats", 
				value: [
				`Most Kills Against: ${mostKilledVictimName} (${mostKillsVsVictim})`,
				`Most Deaths Against: ${mostDeathsVsName} (${mostDeathsVsCount})`,
				`Most Elo Gained From: ${mostEloGainedFromName} (${isFinite(mostEloGained) ? mostEloGained.toFixed(0) : "N/A"})`,
				`Most Elo Lost To: ${mostEloLostToName} (${isFinite(mostEloLostValue) ? mostEloLostValue.toFixed(0) : "N/A"})`
			].join("\n"),
			inline: true
				//end row 4/5 depending on population
			}
		]);

		let achievementLogText = "";
		if (achievementsEnabled && (targetSeason.active || endOfSeasonStats)) {
			const userAchievements = targetSeason.active ? user.achievements : endOfSeasonStats.achievements ?? [];
			const achievements = userAchievements.map(userAchInfo => app.achievementManager.getAchievement(userAchInfo.id)).sort();
			const dbAchievements = await Promise.all(
				achievements.map(ach => {
					if (targetSeason.active) return app.achievementsDb.get(ach.id);
					return targetSeason.endStats.achievementHistory.find(a => a.id == ach.id);
				})
			);

			const topAchievements = dbAchievements.sort((a, b) => {
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
