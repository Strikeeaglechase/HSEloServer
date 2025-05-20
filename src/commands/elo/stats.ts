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
  if (
    query.match(
      /(https):\/\/steamcommunity\.com\/profiles\/[0-9]+|(http):\/\/steamcommunity\.com\/profiles\/[0-9]+/gim
    )
  ) {
    const userIdUser = await users.get(
      query.replace(
        /(https):\/\/steamcommunity\.com\/profiles\/|(http):\/\/steamcommunity\.com\/profiles\//gim,
        ""
      )
    );
    if (userIdUser) return userIdUser;
  } else if (query.match(/[0-9]+/gim)) {
    const userIdUser = await users.get(query);
    if (userIdUser) return userIdUser;
  }

  // DiscordID
  if (query.match(/<@[0-9]+>/gim)) {
    const discordIdUser = await users.collection.findOne({
      discordId: query.replace(/<@|>/gim, ""),
    });
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
  while (
    loginIdx < user.loginTimes.length &&
    logoutIdx < user.logoutTimes.length
  ) {
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

function getKillsPerHour(
  user: User,
  kills: { [key: string]: unknown }[],
  targetSeason: { startTime: number; endTime?: number }
): string {
  if (!user.sessions || user.sessions.length === 0) return "0.00";
  const seasonStart = targetSeason.startTime;
  const seasonEnd = targetSeason.endTime ?? Date.now();

  const validSessions = user.sessions.filter((session) => {
    if (
      typeof session.startTime !== "number" ||
      typeof session.endTime !== "number" ||
      session.endTime <= session.startTime
    ) {
      return false;
    }
    const sessionLength = session.endTime - session.startTime;
    if (sessionLength > 3960000) return false;
	
    return session.startTime < seasonEnd && session.endTime > seasonStart;
  });

  const totalOnlineMs = validSessions.reduce((acc, session) => {
    const sessionStart = Math.max(session.startTime, seasonStart);
    const sessionEnd = Math.min(session.endTime, seasonEnd);
    return acc + Math.max(0, sessionEnd - sessionStart);
  }, 0);

  const totalOnlineHours = totalOnlineMs / 1000 / 60 / 60;
  if (totalOnlineHours === 0) return "0.00";
  return (kills.length / totalOnlineHours).toFixed(2);
}


function getAvgSessionLength(
  user: User,
  targetSeason: { startTime: number; endTime?: number }
): string {
  if (!user.sessions || user.sessions.length === 0)
    return "Avg. Session Length: N/A";
  const seasonStart = targetSeason.startTime;
  const seasonEnd = targetSeason.endTime ?? Date.now();

  const validSessions = user.sessions.filter((session) => {
    if (
      typeof session.startTime !== "number" ||
      typeof session.endTime !== "number" ||
      session.endTime <= session.startTime
    ) {
      return false;
    }
    const sessionLength = session.endTime - session.startTime;
    if (sessionLength > 3960000) return false;
    return session.startTime < seasonEnd && session.endTime > seasonStart;
  });

  if (validSessions.length === 0) return "Avg. Session Length: N/A";

  const totalMs = validSessions.reduce((acc, session) => {
    const sessionStart = Math.max(session.startTime, seasonStart);
    const sessionEnd = Math.min(session.endTime, seasonEnd);
    return acc + Math.max(0, sessionEnd - sessionStart);
  }, 0);

  const avgMs = totalMs / validSessions.length;
  const avgMin = avgMs / 1000 / 60;
  return `Avg. Session Length: ${avgMin.toFixed(2)} min`;
}

function getAircraftStatsFields(
  aircraftStats: Array<{
    label: string;
    kdr: string | number;
    weaponKills: Array<{ weapon: string; count: number }>;
  }>
) {
  const aircraftFieldDefs = [
    { key: "EF-24G", display: "EF-24G Stats" },
    { key: "T-55", display: "T-55 Stats" },
    { key: "FA-26B", display: "FA-26B Stats" },
    { key: "F-45A", display: "F-45A Stats" },
    { key: "AV-42C", display: "AV-42C Stats" },
  ];
  return aircraftFieldDefs
    .map(({ key, display }) => {
      const ac = aircraftStats.find((a) => a.label === key);
      const totalKills =
        ac?.weaponKills.reduce((sum, w) => sum + w.count, 0) || 0;
      if (!ac || totalKills === 0) return null;
      const weaponKillsStr =
        ac.weaponKills
          .map((w) => `${w.count} ${Weapon[w.weapon as keyof typeof Weapon]}`)
          .join("\n") || "<No Data>";
      return {
        name: display,
        value: `Total Kills: ${totalKills}
KDR: ${ac.kdr}
*Weapon Kills*
${weaponKillsStr}`,
        inline: true,
      };
    })
    .filter(Boolean);
}

function getFirstOnline(user: User): string {
  const loginTimes = Array.isArray(user.loginTimes)
    ? user.loginTimes.filter((t) => typeof t === "number" && Number.isFinite(t) && t > 0)
    : [];
  const sessionTimes = Array.isArray(user.sessions)
    ? user.sessions
        .map((s) => s.startTime)
        .filter((t) => typeof t === "number" && Number.isFinite(t) && t > 0)
    : [];
  const allTimes = [...loginTimes, ...sessionTimes];
  if (allTimes.length === 0) return "Never";
  return new Date(Math.min(...allTimes)).toLocaleDateString();
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
        await interaction.editReply(
          framework.error(`Could not find a user with that id/name`)
        );
        return;
      }
    } else {
      const linkedUser = await app.users.collection.findOne({
        discordId: interaction.user.id,
      });
      if (!linkedUser) {
        interaction.editReply(
          framework.error(
            `You must be linked to a steam account to use this command without an argument. \`/link <steamid>\``
          )
        );
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
    let kills = await app.kills.collection
      .find({ "killer.ownerId": user.id, season: targetSeason.id })
      .toArray();
    let deaths = await app.kills.collection
      .find({ "victim.ownerId": user.id, season: targetSeason.id })
      .toArray();
    kills = kills.filter((k) => shouldKillBeCounted(k));
    deaths = deaths.filter((k) => shouldKillBeCounted(k));

    // Count kills per victim
    const killsPerVictim: Record<string, number> = {};
    kills.forEach((kill) => {
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
    deaths.forEach((death) => {
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
      mostDeathsVsName = killerUser
        ? killerUser.pilotNames[0]
        : mostDeathsVsId;
    }
    // Victims pilotname (if available)
    let mostEloLost = 0;
    let mostKilledVictimName = "";
    if (mostKilledVictimId) {
      const victimUser = await app.users.get(mostKilledVictimId);
      mostKilledVictimName = victimUser
        ? victimUser.pilotNames[0]
        : mostKilledVictimId;
    }

    // Longest killstreak and deathstreak
    const events = [
      ...kills.map((k) => ({ type: "kill", time: k.time })),
      ...deaths.map((d) => ({ type: "death", time: d.time })),
    ].sort((a, b) => a.time - b.time);

    let currentKillStreak = 0;
    let longestKillstreak = 0;
    let currentDeathStreak = 0;
    let longestDeathstreak = 0;

    for (const event of events) {
      if (event.type === "kill") {
        currentKillStreak++;
        if (currentKillStreak > longestKillstreak)
          longestKillstreak = currentKillStreak;
        currentDeathStreak = 0;
      } else if (event.type === "death") {
        currentDeathStreak++;
        if (currentDeathStreak > longestDeathstreak)
          longestDeathstreak = currentDeathStreak;
        currentKillStreak = 0;
      }
    }

    const aircraftMetrics = [
      Aircraft.FA26b,
      Aircraft.F45A,
      Aircraft.T55,
      Aircraft.EF24G,
      Aircraft.AV42c,
    ];
    let killsWith = ``;
    let killsAgainst = ``;
    let deathsAgainst = ``;

    aircraftMetrics.forEach((ac) => {
      const killsWithAc = kills.filter((k) => k.killer.type == ac);
      const killsAgainstAc = kills.filter((k) => k.victim.type == ac);
      const deathsAgainstAc = deaths.filter((k) => k.killer.type == ac);

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
      .map((entry) => entry[1] + " " + Weapon[entry[0]])
      .join("\n");
    const weaponDeathsStr = Object.entries(diedToWeapons)
      .sort((a, b) => b[1] - a[1])
      .map((entry) => entry[1] + " " + Weapon[entry[0]])
      .join("\n");

    const endOfSeasonStats = targetSeason.active
      ? null
      : await app.endOfSeasonStats.collection.findOne({
          season: targetSeason.id,
          userId: user.id,
        });
    const rawRank = app.getUserRank(user, targetSeason, endOfSeasonStats);
    const rank = rawRank == "N/A" ? 0 : rawRank;
    const elo = targetSeason.active ? user.elo : endOfSeasonStats?.elo ?? 0;
    const playersWithRank = targetSeason.totalRankedUsers;
    const mostRecentSession =
      user.sessions?.length > 0
        ? user.sessions[user.sessions.length - 1]
        : null;
    const lastOnlineTimeStamp = mostRecentSession
      ? `<t:${Math.floor((mostRecentSession?.startTime ?? 0) / 1000)}:R>`
      : "Never";

    let totalOnlineMs = 0;
    if (user.sessions && user.sessions.length > 0) {
      totalOnlineMs = user.sessions.reduce((acc, session) => {
        if (
          session.startTime &&
          session.endTime &&
          session.endTime > session.startTime
        ) {
          return acc + (session.endTime - session.startTime);
        }
        return acc;
      }, 0);
    }
    const totalOnlineHours = (totalOnlineMs / 1000 / 60 / 60).toFixed(2);

    const aircraftList = [
      { key: Aircraft.FA26b, label: "FA-26B" },
      { key: Aircraft.F45A, label: "F-45A" },
      { key: Aircraft.T55, label: "T-55" },
      { key: Aircraft.EF24G, label: "EF-24G" },
      { key: Aircraft.AV42c, label: "AV-42C" },
    ];

    // Map for aircraft stats
    const aircraftStatsMap: Record<string, { kills: typeof kills; deaths: typeof deaths }> = {};
    aircraftList.forEach((ac) => {
      aircraftStatsMap[ac.label] = { kills: [], deaths: [] };
    });
    kills.forEach((k) => {
      const ac = aircraftList.find((a) => a.key === k.killer.type);
      if (ac) aircraftStatsMap[ac.label].kills.push(k);
    });
    deaths.forEach((d) => {
      const ac = aircraftList.find((a) => a.key === d.victim.type);
      if (ac) aircraftStatsMap[ac.label].deaths.push(d);
    });

    // Calculate aircraft stats, filtering sessions by season time window and session length
    // Use the same logic as getKillsPerHour/getAvgSessionLength for season filtering
    let seasonStart = 0;
    let seasonEnd = Date.now();
    if (targetSeason.active) {
      // Active season: use current time window
      // Optionally, you could set seasonStart to the earliest session startTime for the user in this season
      // but here we use all sessions that overlap with now
      seasonEnd = Date.now();
    } else if (typeof targetSeason.id === "number") {
      // For ended seasons, find the min/max session times for this season's kills/deaths
      const allSessionTimes = (user.sessions ?? [])
        .map(s => [s.startTime, s.endTime])
        .flat()
        .filter(t => typeof t === "number" && Number.isFinite(t));
      if (allSessionTimes.length > 0) {
        seasonStart = Math.min(...allSessionTimes);
        seasonEnd = Math.max(...allSessionTimes);
      }
    }

    const aircraftStats = aircraftList.map((ac) => {
      const acKills = aircraftStatsMap[ac.label].kills;
      const acDeaths = aircraftStatsMap[ac.label].deaths;
      const acKDR =
        acDeaths.length === 0
          ? acKills.length
          : (acKills.length / acDeaths.length).toFixed(2);

      // Filter sessions for this aircraft and season window, using time overlap logic
      const acSessions = (user.sessions ?? []).filter((session) => {
        if (
          typeof session.startTime !== "number" ||
          typeof session.endTime !== "number" ||
          session.endTime <= session.startTime
        ) {
          return false;
        }
        const sessionLength = session.endTime - session.startTime;
        if (sessionLength > 3960000) return false;
        return (
          session.startTime < seasonEnd &&
          session.endTime > seasonStart &&
          "aircraftType" in session &&
          (session as any).aircraftType === ac.key
        );
      });

      const acTotalOnlineMs = acSessions.reduce((acc, session) => {
        const sessionStart = Math.max(session.startTime, seasonStart);
        const sessionEndVal = Math.min(session.endTime, seasonEnd);
        return acc + Math.max(0, sessionEndVal - sessionStart);
      }, 0);

      const acTotalOnlineHours = acTotalOnlineMs / 1000 / 60 / 60;
      const acKillsPerHour =
        acTotalOnlineHours === 0
          ? "0.00"
          : (acKills.length / acTotalOnlineHours).toFixed(2);

      const acWeaponKills: Record<Weapon, number> = {} as Record<Weapon, number>;
      acKills.forEach((k) => {
        acWeaponKills[k.weapon] = (acWeaponKills[k.weapon] ?? 0) + 1;
      });
      const acWeaponKillsArr = Object.entries(acWeaponKills)
        .sort((a, b) => b[1] - a[1])
        .map((entry) => ({ weapon: entry[0], count: entry[1] }));

      return {
        label: ac.label,
        kdr: acKDR,
        killsPerHour: acKillsPerHour,
        weaponKills: acWeaponKillsArr,
      };
    });

    let maxElo = 0;
    user.eloHistory.forEach((h) => (maxElo = Math.max(maxElo, h.elo)));

    const embed = new Discord.EmbedBuilder();
    embed.setColor(0x0099ff);
    embed.setTitle(`Stats for ${user.pilotNames[0]}`);

    // Steam avatar
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

    // Compose fields for embed
    const metricsValue = [
      `ELO: ${Math.floor(elo)}`,
      `Rank: ${rank || "No rank"}`,
      `Top: ${((rank / playersWithRank) * 100).toFixed(0)}%`,
      `Peak: ${Math.floor(maxElo)}`,
      `Avg: ${Math.floor(user.eloHistory.reduce((sum, h) => sum + h.elo, 0) / user.eloHistory.length)}`,
    ].join("\n");

    const kdrValue = `K: ${kills.length} \nD: ${deaths.length} \nR: ${(kills.length / deaths.length).toFixed(2)}`;

    const onlineStatsValue = [
      `First Online: ${getFirstOnline(user)}`,
      `Last Online: ${lastOnlineTimeStamp}`,
      `Online Time: ${totalOnlineHours} hours`,
    ].join("\n");

    const miscStatsValue = [
      `Longest Killstreak: ${longestKillstreak}`,
      `Longest Deathstreak: ${longestDeathstreak}`,
      `Kills/Hr: ${getKillsPerHour(
        user,
        kills.filter(k => k.season === targetSeason.id),
        // Use the season's time window, fallback to all time if not present
        {
          startTime: typeof targetSeason.started === "number" ? targetSeason.started : 0,
          endTime: typeof targetSeason.ended === "number" ? targetSeason.ended : undefined
        }
      )}`,
      `Total Sessions: ${
        Array.isArray(user.sessions)
          ? user.sessions.filter(session =>
              typeof session.startTime === "number" &&
              typeof session.endTime === "number" &&
              session.endTime > session.startTime &&
              session.endTime - session.startTime <= 3960000 &&
              session.startTime < (typeof targetSeason.ended === "number" ? targetSeason.ended : Date.now()) &&
              session.endTime > (typeof targetSeason.started === "number" ? targetSeason.started : 0)
            ).length
          : 0
      }`,
      getAvgSessionLength(user, {
        startTime: typeof targetSeason.started === "number" ? targetSeason.started : 0,
        endTime: typeof targetSeason.ended === "number" ? targetSeason.ended : undefined
      }),
    ].join("\n");

    const vsStatsValue = [
      `Most Kills Against: ${mostKilledVictimName} (${mostKillsVsVictim})`,
      `Most Deaths Against: ${mostDeathsVsName} (${mostDeathsVsCount})`,
    ].join("\n");

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
      ...getAircraftStatsFields(aircraftStats),
      { name: "VS Stats", value: vsStatsValue, inline: true },
    ]);

    // Achievements
    let achievementLogText = "";
    if (achievementsEnabled && (targetSeason.active || endOfSeasonStats)) {
      const userAchievements = targetSeason.active
        ? user.achievements
        : endOfSeasonStats.achievements ?? [];
      const achievements = userAchievements
        .map((userAchInfo) => app.achievementManager.getAchievement(userAchInfo.id))
        .sort();
      const dbAchievements = await Promise.all(
        achievements.map((ach) => {
          if (targetSeason.active) return app.achievementsDb.get(ach.id);
          return targetSeason.endStats.achievementHistory.find((a) => a.id == ach.id);
        })
      );
      const topAchievements = dbAchievements.sort((a, b) => {
        if (a.firstAchievedBy == user.id) return -1;
        const aCount = a.users.length;
        const bCount = b.users.length;
        return bCount - aCount;
      });

      achievementLogText += `\n\n\nAchievement log:\n`;
      topAchievements.forEach((dbAchievement) => {
        const achievement = achievements.find((a) => a.id == dbAchievement.id);
        const userAchievement = userAchievements.find(
          (a) => a.id == dbAchievement.id
        );
        if (!achievement) {
          console.log(
            `Achievement ${dbAchievement.id} was not found in the achievement list`
          );
          console.log(
            `Achievement list: ${achievements.map((a) => a?.id).join(", ")}`
          );
        }

        if (!userAchievement) {
          console.log(
            `UserAchievement ${dbAchievement.id} was not found in the userAchievements list`
          );
          console.log(
            `UserAchievements list: ${userAchievements
              .map((a) => a?.id)
              .join(", ")}`
          );
        }

        achievementLogText += `${achievement.name} x${userAchievement.count} \n`;
        achievementLogText += `${achievement.description} \n`;
        achievementLogText += `First achieved on ${new Date(
          userAchievement.firstAchieved
        ).toISOString()}\n\n`;
      });

      const table: { txt: string; bold: boolean }[][] = [];
      const topSix = topAchievements.slice(0, 6);

      for (let i = 0; i < topSix.length; i += 2) {
        const ach = topSix[i];
        const achievement = achievements.find((a) => a.id == ach.id);
        table.push([
          {
            txt: achievement.name,
            bold: ach.firstAchieved && ach.firstAchievedBy == user.id,
          },
        ]);

        const ach2 = topSix[i + 1];
        if (ach2) {
          const achievement2 = achievements.find((a) => a.id == ach2.id);
          table[table.length - 1].push({
            txt: achievement2.name,
            bold: ach2.firstAchieved && ach2.firstAchievedBy == user.id,
          });
        }
      }

      let achievementsStr = "```ansi\n[4;2m[1;2mAchievements[0m[0m\n";
      const optBold = (entry: { txt: string; bold: boolean }, pad: number) => {
        if (!entry.bold) return entry.txt.padEnd(pad);
        return `[2;37m[1;37m${entry.txt.padEnd(pad)}[0m[2;37m[0m`;
      };
      const col0Pad = Math.max(...table.map((e) => e[0].txt.length)) + 3;
      table.forEach((row) => {
        achievementsStr += optBold(row[0], col0Pad);
        if (row[1]) achievementsStr += optBold(row[1], 0);
        achievementsStr += "\n";
      });

      if (topAchievements.length > 5)
        achievementsStr += `... and ${topAchievements.length - 5} more`;
      achievementsStr += "\n```";
      embed.setDescription(achievementsStr);
    }
    embed.setFooter({ text: `${targetSeason.name} | ID: ${user.id}` });

    // let files: Discord.MessageAttachment[] = [];
    if (targetSeason.active) {
      const path = await createUserEloGraph(user);
      // console.log(path);
      const host = getHost();
      embed.setImage(
        `${host}${ENDPOINT_BASE}public/graph/${user.id}/${Math.floor(
          Math.random() * 1000
        )}`
      );
    }
    const attachment = new Discord.AttachmentBuilder(
      await app.elo.getUserLog(user.id, targetSeason, achievementLogText),
      { name: "history.txt" }
    );
    const files = [attachment];

    interaction.editReply({ embeds: [embed], files });
  }
}

export default Stats;
