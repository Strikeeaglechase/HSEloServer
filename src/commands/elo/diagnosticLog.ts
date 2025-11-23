import { EmbedBuilder } from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { Application } from "../../application.js";
import { shouldKillBeCounted } from "../../elo/eloUpdater.js";
import { Aircraft, CurrentServerInformation, Kill, MissileLaunchParams, Spawn, Team, Tracking, UserAircraftInformation, Weapon } from "../../structures.js";
import { resolveUser } from "../../userUtils.js";

function loadingEmbed(state: string) {
	const emb = new EmbedBuilder();
	emb.setTitle("Generating Diagnostic Log");
	emb.setDescription(state);
	emb.setColor("Yellow");

	return { embeds: [emb] };
}

class TimeCompiledHashMap<T> {
	private map: Record<number, T[]> = {};

	add(time: number, value: T) {
		if (!this.map[time]) this.map[time] = [];
		this.map[time].push(value);
	}

	getData(): T[] {
		const times = Object.keys(this.map).map(k => +k);
		times.sort((a, b) => a - b);

		const result: T[] = [];
		times.forEach(t => {
			result.push(...this.map[t]);
		});

		return result;
	}
}

type EventType =
	| "kill"
	| "death"
	| "spawn"
	| "missileLaunch"
	| "receivedDamage"
	| "dealtDamage"
	| "takeoff"
	| "landing"
	| "tkKick"
	| "leaveServer"
	| "joinServer";

const names = (acInfo: UserAircraftInformation, uDict: Record<string, string>) => {
	if (acInfo.occupants.length == 0) return uDict[acInfo.ownerId];
	if (acInfo.occupants.length == 1) return uDict[acInfo.occupants[0]];

	return acInfo.occupants
		.map(id => {
			const name = uDict[id];
			const isEntOwner = id == acInfo.entOwnerId;
			const isVicControl = id == acInfo.ownerId;
			let suffix = "";
			if (isEntOwner && isVicControl) suffix = "*";
			else if (isEntOwner) suffix = "+";
			else if (isVicControl) suffix = "^";

			return name + suffix;
		})
		.join(", ");
};

const acInfo = (acInfo: UserAircraftInformation, uDict: Record<string, string>) => {
	return `${Team[acInfo.team]}-${acInfo.slot} ${Aircraft[acInfo.type]} [${names(acInfo, uDict)}]`;
};

const unpackDamage = (dmg: Tracking) => {
	return {
		target: dmg.args[0],
		targetActor: dmg.args[1],
		amount: parseFloat(dmg.args[2]),
		type: dmg.args[3],
		hpIndex: parseInt(dmg.args[4]),
		source: dmg.args[5],
		weaponId: dmg.args[6],
		weaponUuid: dmg.args[7],
		targetEId: dmg.args[8],
		targetUuid: dmg.args[9]
	};
};

const eventHandlers: Record<EventType, (event: unknown, uDict: Record<string, string>) => string> = {
	kill: (event: Kill, uDict) =>
		`Kill: Killer=${acInfo(event.killer, uDict)} Victim=${acInfo(event.victim, uDict)} Weapon=${event.weapon} Valid=${shouldKillBeCounted(event)}`,
	death: (event: Kill, uDict) =>
		`Death: Killer=${acInfo(event.killer, uDict)} Victim=${acInfo(event.victim, uDict)} Weapon=${event.weapon} Valid=${shouldKillBeCounted(event)}`,
	spawn: (event: Spawn, uDict) => `Spawn: ${acInfo(event.user, uDict)}`,
	missileLaunch: (event: MissileLaunchParams, uDict) => `Missile Launch: Type=${Weapon[event.type]}`,
	receivedDamage: (event: Tracking, uDict) =>
		`Received damage from ${uDict[unpackDamage(event).source]} Amount=${unpackDamage(event).amount.toFixed(2)} Where=${
			unpackDamage(event).hpIndex
		} WeaponUuid=${unpackDamage(event).weaponUuid ?? "N/A"}`,
	dealtDamage: (event: Tracking, uDict) =>
		`Dealt damage to ${uDict[unpackDamage(event).target]} Amount=${unpackDamage(event).amount.toFixed(2)} Where=${unpackDamage(event).hpIndex} WeaponUuid=${
			unpackDamage(event).weaponUuid ?? "N/A"
		}`,
	takeoff: (event: Tracking, uDict) => `Takeoff`,
	landing: (event: Tracking, uDict) => `Landing`,
	tkKick: (event: Tracking, uDict) => `Kick for TKs`,
	leaveServer: (event: Tracking, uDict) => `Left server`,
	joinServer: (event: Tracking, uDict) => `Joined server`
} as const;

interface WrappedEvent<T extends { time: number; id: string } = { time: number; id: string } & unknown> {
	type: EventType;
	data: T;
}

function insertData<T extends { time: number; id: string }>(
	data: T[],
	type: EventType,
	compiledLog: TimeCompiledHashMap<WrappedEvent>,
	dataCounts: Record<EventType, number>
) {
	data.forEach(d => {
		compiledLog.add(d.time, { type, data: d });
	});

	dataCounts[type] = (dataCounts[type] || 0) + data.length;
}

class DiagnosticLog extends SlashCommand {
	name = "diagnosticlog";
	description = "Generates a diagnostic log, a more raw view of the user history";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({ required: false }) username: string) {
		await interaction.reply(loadingEmbed("Resolving user..."));
		const user = await resolveUser(username, framework, app, interaction);
		if (!user) return;
		const activeSeason = await app.getActiveSeason();

		await interaction.editReply(loadingEmbed("Loading primary events..."));
		const kills = await app.kills.collection.find({ "killer.ownerId": user.id, "season": activeSeason.id }).toArray();
		const deaths = await app.kills.collection.find({ "victim.ownerId": user.id, "season": activeSeason.id }).toArray();
		const spawns = await app.spawns.collection.find({ "user.ownerId": user.id, "season": activeSeason.id }).toArray();

		await interaction.editReply(loadingEmbed("Loading secondary events..."));
		const missileLaunchesNoId = await app.missileLaunchParams.collection.find({ "launcher.ownerId": user.id, "season": activeSeason.id }).toArray();
		const missileLaunches = missileLaunchesNoId.map(ml => ({ ...ml, id: ml.uuid }));
		const receivedDamage = await app.tracking.collection.find({ "type": "damage", "args.0": user.id, "season": activeSeason.id }).toArray();
		const dealtDamage = await app.tracking.collection.find({ "type": "damage", "args.5": user.id, "season": activeSeason.id }).toArray();
		const takeoff = await app.tracking.collection.find({ "type": "takeoff", "args.0": user.id, "season": activeSeason.id }).toArray();
		const landing = await app.tracking.collection.find({ "type": "landing", "args.0": user.id, "season": activeSeason.id }).toArray();
		const tkKick = await app.tracking.collection.find({ "type": "tkKick", "args.0": user.id, "season": activeSeason.id }).toArray();
		const leaveServer = await app.tracking.collection.find({ "type": "client_leave", "args.0": user.id, "season": activeSeason.id }).toArray();
		const joinServer = await app.tracking.collection.find({ "type": "client_join", "args.0": user.id, "season": activeSeason.id }).toArray();

		await interaction.editReply(loadingEmbed("Loading usernames..."));
		const userIdsSeen = new Set<string>();
		kills.forEach(k => {
			k.killer.occupants.forEach(o => userIdsSeen.add(o));
			k.victim.occupants.forEach(o => userIdsSeen.add(o));
		});
		deaths.forEach(d => {
			d.killer.occupants.forEach(o => userIdsSeen.add(o));
			d.victim.occupants.forEach(o => userIdsSeen.add(o));
		});
		receivedDamage.forEach(dmg => userIdsSeen.add(dmg.args[5]));
		dealtDamage.forEach(dmg => userIdsSeen.add(dmg.args[0]));
		const userIdToName: Record<string, string> = {};
		const seenUsers = await app.users.collection.find({ id: { $in: Array.from(userIdsSeen) } }, { projection: { pilotNames: 1, id: 1 } }).toArray();
		seenUsers.forEach(u => {
			userIdToName[u.id] = `${u.pilotNames[0] || "Unknown"} (${u.id})`;
		});

		await interaction.editReply(loadingEmbed("Compiling log..."));
		const compiledLog = new TimeCompiledHashMap<WrappedEvent>();
		const dataCounts: Record<EventType, number> = {} as any;
		insertData(kills, "kill", compiledLog, dataCounts);
		insertData(deaths, "death", compiledLog, dataCounts);
		insertData(spawns, "spawn", compiledLog, dataCounts);
		insertData(missileLaunches, "missileLaunch", compiledLog, dataCounts);
		insertData(receivedDamage, "receivedDamage", compiledLog, dataCounts);
		insertData(dealtDamage, "dealtDamage", compiledLog, dataCounts);
		insertData(takeoff, "takeoff", compiledLog, dataCounts);
		insertData(landing, "landing", compiledLog, dataCounts);
		insertData(tkKick, "tkKick", compiledLog, dataCounts);
		insertData(leaveServer, "leaveServer", compiledLog, dataCounts);
		insertData(joinServer, "joinServer", compiledLog, dataCounts);

		const finalLog = compiledLog.getData();

		await interaction.editReply(loadingEmbed(`Processing log (${finalLog.length} entries)...`));
		let prevServerInfo: CurrentServerInformation;
		const logLines: string[] = [];
		finalLog.forEach(entry => {
			const timeStamp = new Date(entry.data.time).toISOString();
			const handler = eventHandlers[entry.type] ?? (evt => `No handler for event type ${entry.type}`);

			if ("serverInfo" in entry.data) {
				const currInfo = (entry.data as any).serverInfo as CurrentServerInformation;
				if (!prevServerInfo || prevServerInfo.missionId != currInfo.missionId || prevServerInfo.replayId != currInfo.replayId) {
					logLines.push(`[${timeStamp}] Server info change: Mission=${currInfo.missionId} Replay=${currInfo.replayId}`);
					prevServerInfo = currInfo;
				}
			}

			logLines.push(`[${timeStamp}] ${handler(entry.data, userIdToName)} ID: ${entry.data.id}`);
		});

		const logContent = logLines.join("\n");
		const buffer = Buffer.from(logContent, "utf-8");

		const embed = new EmbedBuilder();
		embed.setTitle(`Diagnostic Log for ${user.pilotNames[0]}`);
		embed.setFooter({ text: `${activeSeason.name} | ID: ${user.id}` });
		embed.setColor("Orange");

		const counts = Object.entries(dataCounts)
			.map(([type, count]) => `${type}: ${count}`)
			.join("\n");

		embed.setDescription(`**Event Counts:**\n\`\`\`\n${counts}\n\`\`\``);

		await interaction.editReply({
			embeds: [embed],
			files: [{ attachment: buffer, name: `diagnostic_log_${user.id}.txt` }]
		});
	}
}

export default DiagnosticLog;
