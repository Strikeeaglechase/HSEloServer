import Discord, { CommandInteraction } from "discord.js";
import FrameworkClient from "strike-discord-framework";
import { CollectionManager } from "strike-discord-framework/dist/collectionManager.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { shouldKillBeCounted } from "../../elo/eloUpdater.js";
import { Aircraft, Kill, Season, User, Weapon } from "../../structures.js";
import { Application } from "../../application.js";

async function lookupUser(users: CollectionManager<User>, query: string) {
	if (query.match(/(https):\/\/steamcommunity\.com\/profiles\/[0-9]+|(http):\/\/steamcommunity\.com\/profiles\/[0-9]+/gim)) {
		const userIdUser = await users.get(query.replace(/(https):\/\/steamcommunity\.com\/profiles\/|(http):\/\/steamcommunity\.com\/profiles\//gim, ""));
		if (userIdUser) return userIdUser;
	} else if (query.match(/[0-9]+/gim)) {
		const userIdUser = await users.get(query);
		if (userIdUser) return userIdUser;
	}

	const pilotNameUser = await users.collection.find({ pilotNames: { $regex: query, $options: "i" } }).toArray();
	if (pilotNameUser.length > 0) {
		return pilotNameUser.sort((a, b) => b.elo - a.elo)[0];
	}
}

async function resolveUser(username: string, framework: FrameworkClient, app: Application, interaction: CommandInteraction) {
	let user: User;
	if (username) {
		user = await lookupUser(app.users, username);
		if (!user) {
			await interaction.editReply(framework.error(`Could not find a user with that id/name`));
			return null;
		}
	} else {
		const linkedUser = await app.users.collection.findOne({
			discordId: interaction.user.id
		});
		if (!linkedUser) {
			await interaction.editReply(framework.error(`Could not find a linked user. Use /link to link your account`));
			return null;
		}
		user = linkedUser;
	}

	return user;
}

async function resolveSeason(season: number, framework: FrameworkClient, app: Application, interaction: CommandInteraction) {
	const activeSeason = await app.getActiveSeason();
	let targetSeason = activeSeason;
	if (season) {
		targetSeason = await app.getSeason(season);
		if (!targetSeason) {
			interaction.editReply(framework.error(`Could not find that season`));
			return null;
		}
	}

	return targetSeason;
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

		const missileWeapons = [
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
		const nonTrackedWeapons = [Weapon.Gun, Weapon.CFIT];

		const missileKills = kills.filter(k => missileWeapons.includes(k.weapon));

		const damageWeaponUuids = new Set(damageEvents.map(de => de.args[7]).filter(uuid => uuid));

		const missileHits = missileLaunches.filter(ml => damageWeaponUuids.has(ml.uuid));

		const weaponStats: Record<Weapon, { fired: number; hit: number; kill: number }> = {} as any;

		missileLaunches.forEach(ml => {
			if (!weaponStats[ml.type]) {
				weaponStats[ml.type] = { fired: 0, hit: 0, kill: 0 };
			}
			weaponStats[ml.type].fired++;
		});

		missileHits.forEach(ml => {
			if (weaponStats[ml.type]) {
				weaponStats[ml.type].hit++;
			}
		});

		missileKills.forEach(k => {
			if (!weaponStats[k.weapon]) {
				weaponStats[k.weapon] = { fired: 0, hit: 0, kill: 0 };
			}
			weaponStats[k.weapon].kill++;
		});

		kills
			.filter(k => nonTrackedWeapons.includes(k.weapon))
			.forEach(k => {
				if (!weaponStats[k.weapon]) {
					weaponStats[k.weapon] = { fired: 0, hit: 0, kill: 0 };
				}
				weaponStats[k.weapon].kill++;
			});

		const sortedWeapons = Object.entries(weaponStats).sort((a, b) => {
			const aIsNonTracked = nonTrackedWeapons.includes(+a[0] as Weapon);
			const bIsNonTracked = nonTrackedWeapons.includes(+b[0] as Weapon);

			if (aIsNonTracked && !bIsNonTracked) return 1;
			if (!aIsNonTracked && bIsNonTracked) return -1;

			if (b[1].kill !== a[1].kill) return b[1].kill - a[1].kill;
			return b[1].fired - a[1].fired;
		});

		const fields: { name: string; value: string; inline: boolean }[] = [];

		if (sortedWeapons.length > 0) {
			let maxWeaponLen = 6; // "Weapon" header length
			let maxFireLen = 5; // "Fired" header length
			let maxHitLen = 3; // "Hit" header length
			let maxKillLen = 4; // "Kill" header length

			for (const [weaponType, stats] of sortedWeapons) {
				const weapon = Weapon[+weaponType as Weapon];
				if (!weapon || weapon === "Invalid") continue;
				maxWeaponLen = Math.max(maxWeaponLen, weapon.length);
				maxFireLen = Math.max(maxFireLen, stats.fired.toString().length);
				maxHitLen = Math.max(maxHitLen, stats.hit.toString().length);
				maxKillLen = Math.max(maxKillLen, stats.kill.toString().length);
			}

			let overviewText = "```ansi\n";
			const headerText = "All Weapons Overview";
			const tableWidth = maxWeaponLen + 1 + maxFireLen + 1 + maxHitLen + 1 + maxKillLen + 1 + 5 + 1 + 4; // columns + spaces + pH + pK
			const totalWidth = Math.max(tableWidth, headerText.length + 4);
			const paddingNeeded = Math.max(0, totalWidth - headerText.length);
			const leftPad = Math.floor(paddingNeeded / 2);
			const rightPad = paddingNeeded - leftPad;
			overviewText += "=".repeat(leftPad) + "\u001b[0;31m" + headerText + "\u001b[0m" + "=".repeat(rightPad) + "\n";
			overviewText +=
				"Weapon".padEnd(maxWeaponLen) +
				" " +
				"Fired".padStart(maxFireLen) +
				" " +
				"Hit".padStart(maxHitLen) +
				" " +
				"Kill".padStart(maxKillLen) +
				" " +
				"pH".padStart(5) +
				" " +
				"pK".padStart(4) +
				"\n";

			for (const [weaponType, stats] of sortedWeapons) {
				const weapon = Weapon[+weaponType as Weapon];
				if (!weapon || weapon === "Invalid") continue;
				const isTracked = !nonTrackedWeapons.includes(+weaponType as Weapon);

				if (isTracked) {
					const pK = stats.fired > 0 ? ((stats.kill / stats.fired) * 100).toFixed(0) : "0";
					const pH = stats.fired > 0 ? ((stats.hit / stats.fired) * 100).toFixed(0) : "0";
					const weaponPadded = weapon.padEnd(maxWeaponLen);
					const firedPadded = stats.fired.toString().padStart(maxFireLen);
					const hitPadded = stats.hit.toString().padStart(maxHitLen);
					const killPadded = stats.kill.toString().padStart(maxKillLen);
					const pHPadded = (pH + "%").padStart(5);
					const pKPadded = (pK + "%").padStart(4);
					overviewText += `${weaponPadded} ${firedPadded} ${hitPadded} ${killPadded} ${pHPadded} ${pKPadded}\n`;
				} else {
					const weaponPadded = weapon.padEnd(maxWeaponLen);
					const killPadded = stats.kill.toString().padStart(maxKillLen);
					const dashFire = "-".padStart(maxFireLen);
					const dashHit = "-".padStart(maxHitLen);
					overviewText += `${weaponPadded} ${dashFire} ${dashHit} ${killPadded}     -    -\n`;
				}
			}
			overviewText += "```";
			fields.push({ name: "\u200B", value: overviewText, inline: false });
		}

		const spawns = await app.spawns.collection.find({ "user.ownerId": user.id, "season": targetSeason.id }).toArray();
		const aircraftWithData = [...new Set(spawns.map(s => s.user.type))];

		for (const aircraftType of aircraftWithData) {
			const aircraftName = Aircraft[aircraftType];

			const aircraftKills = kills.filter(k => k.killer.type === aircraftType);

			const aircraftMissileKills = aircraftKills.filter(k => missileWeapons.includes(k.weapon));

			const aircraftMissileLaunches = missileLaunches.filter(ml => ml.launcher.type === aircraftType);

			const aircraftLaunchUuids = new Set(aircraftMissileLaunches.map(ml => ml.uuid));
			const aircraftDamageEvents = damageEvents.filter(de => aircraftLaunchUuids.has(de.args[7]));
			const aircraftDamageWeaponUuids = new Set(aircraftDamageEvents.map(de => de.args[7]).filter(uuid => uuid));

			const aircraftMissileHits = aircraftMissileLaunches.filter(ml => aircraftDamageWeaponUuids.has(ml.uuid));

			const aircraftWeaponStats: Record<Weapon, { fired: number; hit: number; kill: number }> = {} as any;

			aircraftMissileLaunches.forEach(ml => {
				if (!aircraftWeaponStats[ml.type]) {
					aircraftWeaponStats[ml.type] = { fired: 0, hit: 0, kill: 0 };
				}
				aircraftWeaponStats[ml.type].fired++;
			});

			// Count hits
			aircraftMissileHits.forEach(ml => {
				if (aircraftWeaponStats[ml.type]) {
					aircraftWeaponStats[ml.type].hit++;
				}
			});

			aircraftMissileKills.forEach(k => {
				if (!aircraftWeaponStats[k.weapon]) {
					aircraftWeaponStats[k.weapon] = { fired: 0, hit: 0, kill: 0 };
				}
				aircraftWeaponStats[k.weapon].kill++;
			});

			aircraftKills
				.filter(k => nonTrackedWeapons.includes(k.weapon))
				.forEach(k => {
					if (!aircraftWeaponStats[k.weapon]) {
						aircraftWeaponStats[k.weapon] = { fired: 0, hit: 0, kill: 0 };
					}
					aircraftWeaponStats[k.weapon].kill++;
				});

			if (Object.keys(aircraftWeaponStats).length > 0) {
				const sortedAircraftWeapons = Object.entries(aircraftWeaponStats).sort((a, b) => {
					const aIsNonTracked = nonTrackedWeapons.includes(+a[0] as Weapon);
					const bIsNonTracked = nonTrackedWeapons.includes(+b[0] as Weapon);

					if (aIsNonTracked && !bIsNonTracked) return 1;
					if (!aIsNonTracked && bIsNonTracked) return -1;

					if (b[1].kill !== a[1].kill) return b[1].kill - a[1].kill;
					return b[1].fired - a[1].fired;
				});

				let maxWeaponLen = 6;
				let maxFireLen = 5;
				let maxHitLen = 3;
				let maxKillLen = 4;

				for (const [weaponType, stats] of sortedAircraftWeapons) {
					const weapon = Weapon[+weaponType as Weapon];
					if (!weapon || weapon === "Invalid") continue;
					maxWeaponLen = Math.max(maxWeaponLen, weapon.length);
					maxFireLen = Math.max(maxFireLen, stats.fired.toString().length);
					maxHitLen = Math.max(maxHitLen, stats.hit.toString().length);
					maxKillLen = Math.max(maxKillLen, stats.kill.toString().length);
				}

				let aircraftText = "```ansi\n";
				const headerText = aircraftName;
				const tableWidth = maxWeaponLen + 1 + maxFireLen + 1 + maxHitLen + 1 + maxKillLen + 1 + 5 + 1 + 4;
				const totalWidth = Math.max(tableWidth, headerText.length + 4);
				const paddingNeeded = Math.max(0, totalWidth - headerText.length);
				const leftPad = Math.floor(paddingNeeded / 2);
				const rightPad = paddingNeeded - leftPad;
				aircraftText += "=".repeat(leftPad) + "\u001b[0;31m" + headerText + "\u001b[0m" + "=".repeat(rightPad) + "\n";
				aircraftText +=
					"Weapon".padEnd(maxWeaponLen) +
					" " +
					"Fired".padStart(maxFireLen) +
					" " +
					"Hit".padStart(maxHitLen) +
					" " +
					"Kill".padStart(maxKillLen) +
					" " +
					"pH".padStart(5) +
					" " +
					"pK".padStart(4) +
					"\n";

				for (const [weaponType, stats] of sortedAircraftWeapons) {
					const weapon = Weapon[+weaponType as Weapon];
					if (!weapon || weapon === "Invalid") continue;
					const isTracked = !nonTrackedWeapons.includes(+weaponType as Weapon);

					if (isTracked) {
						const pK = stats.fired > 0 ? ((stats.kill / stats.fired) * 100).toFixed(0) : "0";
						const pH = stats.fired > 0 ? ((stats.hit / stats.fired) * 100).toFixed(0) : "0";
						const weaponPadded = weapon.padEnd(maxWeaponLen);
						const firedPadded = stats.fired.toString().padStart(maxFireLen);
						const hitPadded = stats.hit.toString().padStart(maxHitLen);
						const killPadded = stats.kill.toString().padStart(maxKillLen);
						const pHPadded = (pH + "%").padStart(5);
						const pKPadded = (pK + "%").padStart(4);
						aircraftText += `${weaponPadded} ${firedPadded} ${hitPadded} ${killPadded} ${pHPadded} ${pKPadded}\n`;
					} else {
						const weaponPadded = weapon.padEnd(maxWeaponLen);
						const killPadded = stats.kill.toString().padStart(maxKillLen);
						const dashFire = "-".padStart(maxFireLen);
						const dashHit = "-".padStart(maxHitLen);
						aircraftText += `${weaponPadded} ${dashFire} ${dashHit} ${killPadded}     -    -\n`;
					}
				}
				aircraftText += "```";
				fields.push({ name: "\u200B", value: aircraftText, inline: false });
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
