import Discord from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { shouldKillBeCounted } from "../../elo/eloUpdater.js";
import { resolveUser, resolveSeason } from "../../userUtils.js";
import { Aircraft, Kill, MissileLaunchParams, Tracking, Weapon } from "../../structures.js";
import { Application } from "../../application.js";

interface WeaponStats {
	fired: number;
	hit: number;
	kill: number;
}

interface WeaponStatsMap {
	[weapon: string]: WeaponStats;
}

const MISSILE_WEAPONS = [
	Weapon.AIM120,
	Weapon.AIM9,
	Weapon.AIM7,
	Weapon.AIM9X,
	Weapon.AIRST,
	Weapon.AIM9E,
	Weapon.AIM54,
	Weapon.HARM,
	Weapon.AGM145,
	Weapon.MALD
];

const NON_TRACKED_WEAPONS = [Weapon.Gun, Weapon.CFIT];

function initializeWeaponStats(): WeaponStats {
	return { fired: 0, hit: 0, kill: 0 };
}

function calculateAircraftWeaponStats(
	aircraftType: Aircraft,
	kills: Kill[],
	missileLaunches: MissileLaunchParams[],
	damageEvents: Tracking[]
): WeaponStatsMap {
	const aircraftKills = kills.filter(k => k.killer.type === aircraftType);
	const aircraftMissileLaunches = missileLaunches.filter(ml => ml.launcher.type === aircraftType);

	const aircraftLaunchUuids = new Set(aircraftMissileLaunches.map(ml => ml.uuid));
	const aircraftDamageEvents = damageEvents.filter(de => aircraftLaunchUuids.has(de.args[7]));

	return calculateWeaponStats(aircraftKills, aircraftMissileLaunches, aircraftDamageEvents);
}

function calculateWeaponStats(
	kills: Kill[],
	missileLaunches: MissileLaunchParams[],
	damageEvents: Tracking[]
): WeaponStatsMap {
	const weaponStats: WeaponStatsMap = {};
	
	const missileKills = kills.filter(k => MISSILE_WEAPONS.includes(k.weapon));
	const damageWeaponUuids = new Set(damageEvents.map(de => de.args[7]).filter(uuid => uuid));
	const missileHits = missileLaunches.filter(ml => damageWeaponUuids.has(ml.uuid));

	missileLaunches.forEach(ml => {
		const weaponKey = ml.type.toString();
		if (!weaponStats[weaponKey]) {
			weaponStats[weaponKey] = initializeWeaponStats();
		}
		weaponStats[weaponKey].fired++;
	});

	missileHits.forEach(ml => {
		const weaponKey = ml.type.toString();
		if (weaponStats[weaponKey]) {
			weaponStats[weaponKey].hit++;
		}
	});

	missileKills.forEach(k => {
		const weaponKey = k.weapon.toString();
		if (!weaponStats[weaponKey]) {
			weaponStats[weaponKey] = initializeWeaponStats();
		}
		weaponStats[weaponKey].kill++;
	});

	kills
		.filter(k => NON_TRACKED_WEAPONS.includes(k.weapon))
		.forEach(k => {
			const weaponKey = k.weapon.toString();
			if (!weaponStats[weaponKey]) {
				weaponStats[weaponKey] = initializeWeaponStats();
			}
			weaponStats[weaponKey].kill++;
		});

	Object.keys(weaponStats).forEach(weaponKey => {
		weaponStats[weaponKey].hit = Math.max(weaponStats[weaponKey].hit, weaponStats[weaponKey].kill);
	});

	return weaponStats;
}

function sortWeaponStats(weaponStats: WeaponStatsMap): Array<[string, WeaponStats]> {
	return Object.entries(weaponStats).sort((a, b) => {
		const aWeapon = parseInt(a[0]) as Weapon;
		const bWeapon = parseInt(b[0]) as Weapon;
		const aIsNonTracked = NON_TRACKED_WEAPONS.includes(aWeapon);
		const bIsNonTracked = NON_TRACKED_WEAPONS.includes(bWeapon);

		if (aIsNonTracked && !bIsNonTracked) return 1;
		if (!aIsNonTracked && bIsNonTracked) return -1;

		if (b[1].kill !== a[1].kill) return b[1].kill - a[1].kill;
		return b[1].fired - a[1].fired;
	});
}

function createWeaponStatsTable(sortedWeapons: Array<[string, WeaponStats]>, headerText: string): string {
	if (sortedWeapons.length === 0) return "";

	let maxWeaponLen = 6;
	let maxFireLen = 5;
	let maxHitLen = 3;
	let maxKillLen = 4;

	for (const [weaponType, stats] of sortedWeapons) {
		const weapon = Weapon[parseInt(weaponType) as Weapon];
		if (!weapon || weapon === "Invalid") continue;
		maxWeaponLen = Math.max(maxWeaponLen, weapon.length);
		maxFireLen = Math.max(maxFireLen, stats.fired.toString().length);
		maxHitLen = Math.max(maxHitLen, stats.hit.toString().length);
		maxKillLen = Math.max(maxKillLen, stats.kill.toString().length);
	}

	const lines: string[] = ["```ansi"];
	const tableWidth = maxWeaponLen + 1 + maxFireLen + 1 + maxHitLen + 1 + maxKillLen + 1 + 5 + 1 + 4;
	const totalWidth = Math.max(tableWidth, headerText.length + 4);
	const paddingNeeded = Math.max(0, totalWidth - headerText.length);
	const leftPad = Math.floor(paddingNeeded / 2);
	const rightPad = paddingNeeded - leftPad;
	lines.push(`${"=".repeat(leftPad)}\u001b[0;31m${headerText}\u001b[0m${"=".repeat(rightPad)}`);
	lines.push(`${"Weapon".padEnd(maxWeaponLen)} ${"Fired".padStart(maxFireLen)} ${"Hit".padStart(maxHitLen)} ${"Kill".padStart(maxKillLen)} ${"pH".padStart(5)} ${"pK".padStart(4)}`);

	for (const [weaponType, stats] of sortedWeapons) {
		const weaponEnum = parseInt(weaponType) as Weapon;
		const weapon = Weapon[weaponEnum];
		if (!weapon || weapon === "Invalid") continue;
		const isTracked = !NON_TRACKED_WEAPONS.includes(weaponEnum);

		if (isTracked) {
			const pK = stats.fired > 0 ? ((stats.kill / stats.fired) * 100).toFixed(0) : "0";
			const pH = stats.fired > 0 ? ((stats.hit / stats.fired) * 100).toFixed(0) : "0";
			lines.push(`${weapon.padEnd(maxWeaponLen)} ${stats.fired.toString().padStart(maxFireLen)} ${stats.hit.toString().padStart(maxHitLen)} ${stats.kill.toString().padStart(maxKillLen)} ${`${pH}%`.padStart(5)} ${`${pK}%`.padStart(4)}`);
		} else {
			lines.push(`${weapon.padEnd(maxWeaponLen)} ${"-".padStart(maxFireLen)} ${"-".padStart(maxHitLen)} ${stats.kill.toString().padStart(maxKillLen)}     -    -`);
		}
	}
	lines.push("```");
	return lines.join("\n");
}

class PK extends SlashCommand {
	name = "pk";
	description = "Gets pK (probability of kill) statistics for yourself or another user";

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
		kills = kills.filter(k => shouldKillBeCounted(k));

		const missileLaunches = await app.missileLaunchParams.collection.find({ "launcher.ownerId": user.id, "season": targetSeason.id }).toArray();
		const damageEvents = await app.tracking.collection.find({ "type": "damage", "args.5": user.id, "season": targetSeason.id }).toArray();

		const weaponStats = calculateWeaponStats(kills, missileLaunches, damageEvents);
		const sortedWeapons = sortWeaponStats(weaponStats);

		const fields: { name: string; value: string; inline: boolean }[] = [];

		const overviewText = createWeaponStatsTable(sortedWeapons, "All Weapons Overview");
		if (overviewText) {
			fields.push({ name: "\u200B", value: overviewText, inline: false });
		}

		const aircraftWithData = [...new Set(kills.map(k => k.killer.type))];

		for (const aircraftType of aircraftWithData) {
			const aircraftName = Aircraft[aircraftType];
			const aircraftWeaponStats = calculateAircraftWeaponStats(aircraftType, kills, missileLaunches, damageEvents);

			if (Object.keys(aircraftWeaponStats).length > 0) {
				const sortedAircraftWeapons = sortWeaponStats(aircraftWeaponStats);
				const aircraftText = createWeaponStatsTable(sortedAircraftWeapons, aircraftName);
				if (aircraftText) {
					fields.push({ name: "\u200B", value: aircraftText, inline: false });
				}
			}
		}

		const embed = new Discord.EmbedBuilder();
		embed.setColor(0x0099ff);
		embed.setTitle(`pK Statistics for ${user.pilotNames[0]}`);

		if (fields.length > 0) {
			embed.addFields(fields);
		} else {
			embed.addFields([{ name: "\u200B", value: "<No Data>", inline: false }]);
		}

		embed.setFooter({ text: `${targetSeason.name} | ID: ${user.id}` });

		interaction.editReply({ embeds: [embed] });
	}
}

export default PK;
