import { config } from "dotenv";
import fs from "fs";

import Database from "../../db/database.js";
import { Aircraft, Kill, User, Weapon } from "../../structures.js";
import { getKillStr, KillMetric, KillString, maxWeaponMultiplier, shouldKillBeCounted } from "../eloUpdater.js";

config({ path: "../../.env" });
function streamFile<T>(path: string, cb: (data: T) => void): Promise<void> {
	const readStream = fs.createReadStream(path);
	return new Promise(res => {
		let remaining = "";
		const result: T[] = [];

		readStream.on("data", data => {
			const parts = (remaining + data).split("\n");
			remaining = parts.pop();

			parts.forEach(part => cb(JSON.parse(part)));
		});

		readStream.on("end", () => {
			if (remaining.length > 0) cb(JSON.parse(remaining));
			res();
		});
	});
}

function shouldKillContributeToMultipliers(kill: Kill) {
	if (kill.weapon == Weapon.CFIT || kill.weapon == Weapon.DCCFIT) return false;
	if (kill.weapon == Weapon.Collision) return false;
	return shouldKillBeCounted(kill);
}

async function calculateEloMultipliersStreamed(excludeKillerList: string[]) {
	const killCounts: Record<KillString, number> = {};
	let totalCountedKills = 0;

	await streamFile<Kill>(`../../../prodHourlyReport/kills.json`, kill => {
		if (!shouldKillContributeToMultipliers(kill)) return;
		if (excludeKillerList.includes(kill.killer.ownerId)) return;
		const str = getKillStr(kill);
		killCounts[str] = (killCounts[str] || 0) + 1;
		totalCountedKills++;
	});

	const killMetrics: KillMetric[] = [];

	for (const [killStr, count] of Object.entries(killCounts)) {
		killMetrics.push({ killStr: killStr as KillString, count, prec: count / totalCountedKills, multiplier: 1 });
	}

	const relevantMetrics = killMetrics.sort((a, b) => b.count - a.count);

	const expectPrec = 1 / relevantMetrics.length;
	const normalizerMetricPrec = relevantMetrics.find(m => m.killStr == "FourthGen->HighTechRadar->FourthGen")?.prec ?? expectPrec;

	const normalizer = 1 / (expectPrec / normalizerMetricPrec);
	relevantMetrics.forEach(metric => {
		const multiplier = (expectPrec / metric.prec) * normalizer;
		metric.multiplier = Math.min(multiplier, maxWeaponMultiplier);
	});

	console.log(`Calculated ${relevantMetrics.length} kill multipliers`);

	return relevantMetrics;
}

interface AircraftKillMetrics {
	totalKillSeen: number;
	totalKills: number;
	weaponsUsed: Record<Weapon, number>;
	aircraftKilled: Record<Aircraft, number>;
	aircraftSeenWhenKill: Record<Aircraft, number>;

	mult: number;
	weaponMultipliers: Record<Weapon, { mult: number; prec: number; count: number }>;
	aircraftMultipliers: Record<Aircraft, { mult: number; seenPrec: number; killedPrec: number; count: number }>;
}

async function calculateNewMultipliersStreamed(excludeKillerList: string[]) {
	// const killCounts: Partial<Record<Aircraft, Record<KillString, number>>> = {};
	const killCounts: Record<Aircraft, AircraftKillMetrics> = {} as any;

	const aircraft = [Aircraft.FA26b, Aircraft.F45A, Aircraft.T55, Aircraft.EF24G];

	aircraft.forEach(ac => {
		killCounts[ac] = {
			totalKillSeen: 0,
			totalKills: 0,
			mult: 0,
			weaponsUsed: {} as any,
			aircraftKilled: {} as any,
			aircraftSeenWhenKill: {} as any,

			weaponMultipliers: {} as any,
			aircraftMultipliers: {} as any
		};
	});

	let totalCountedKills = 0;
	let totalCountedAircraft = 0;

	// const acKillTotals: Partial<Record<Aircraft, number>> = {};
	// const acAroundTotals: Partial<Record<Aircraft, number>> = {};

	// const aircraftWeaponUsage: Partial<Record<Aircraft, Record<Weapon, number>>> = {};
	// aircraft.forEach(ac => {
	// 	aircraftWeaponUsage[ac] = {} as any;
	// });

	await streamFile<Kill>(`../../../prodHourlyReport/kills.json`, kill => {
		if (!shouldKillContributeToMultipliers(kill)) return;
		if (!kill.serverInfo.onlineUsersFull) return;
		if (excludeKillerList.includes(kill.killer.ownerId)) return;

		// aircraftWeaponUsage[kill.killer.type][kill.weapon] = (aircraftWeaponUsage[kill.killer.type][kill.weapon] || 0) + 1;

		const acBucket = killCounts[kill.killer.type];
		acBucket.totalKills++;
		acBucket.aircraftKilled[kill.victim.type] = (acBucket.aircraftKilled[kill.victim.type] || 0) + 1;
		acBucket.weaponsUsed[kill.weapon] = (acBucket.weaponsUsed[kill.weapon] || 0) + 1;

		kill.serverInfo.onlineUsersFull.forEach(user => {
			if (user.type == Aircraft.Invalid) return;
			if (user.ownerId != user.entOwnerId) return; // Avoid double counting multicrew aircraft

			killCounts[user.type].totalKillSeen++;
			acBucket.aircraftSeenWhenKill[user.type] = (acBucket.aircraftSeenWhenKill[user.type] || 0) + 1;

			totalCountedAircraft++;
		});

		totalCountedKills++;
	});

	// const weapons = [Weapon.Gun, Weapon.AIM120, Weapon.AIM9, Weapon.AIM7, Weapon.AIM9X, Weapon.AIRST, Weapon.HARM, Weapon.AIM9E, Weapon.AIM54];
	// aircraft.forEach(ac => {
	// 	const wepStats = aircraftWeaponUsage[ac];
	// 	console.log(`Aircraft ${Aircraft[ac]} weapon usage:`);
	// 	weapons.forEach(weapon => {
	// 		console.log(`${Weapon[weapon]},${wepStats[weapon] || 0}`);
	// 	});
	// });
	// process.exit();

	let resultLog = "";

	aircraft.forEach(ac => {
		const metrics = killCounts[ac];
		const killPrec = metrics.totalKills / totalCountedKills;
		const aroundPrec = metrics.totalKillSeen / totalCountedAircraft;

		const mult = aroundPrec / killPrec;
		metrics.mult = mult;

		console.log(
			`Aircraft ${Aircraft[ac]} has ${(killPrec * 100).toFixed(2)}% kills, compared to being present for ${(aroundPrec * 100).toFixed(
				2
			)}% of kills. Aircraft multiplier: ${mult.toFixed(2)}x`
		);

		resultLog += `${Aircraft[ac]} - ${mult.toFixed(2)}x\n`;

		let totalSeenDuringKills = 0;
		aircraft.forEach(a => (totalSeenDuringKills += metrics.aircraftSeenWhenKill[a]));

		aircraft.forEach(a => {
			const seenDuringKill = metrics.aircraftSeenWhenKill[a] / totalSeenDuringKills;
			const killPrec = metrics.aircraftKilled[a] / metrics.totalKills;
			const mult = seenDuringKill / killPrec;

			console.log(
				` - Aircraft killed ${Aircraft[a]} ${(killPrec * 100).toFixed(2)}% of the time, compared to being present for ${(seenDuringKill * 100).toFixed(
					2
				)}% of the time. Aircraft  multiplier: ${mult.toFixed(2)}x`
			);

			resultLog += ` - vs ${Aircraft[a]} - ${mult.toFixed(2)}x\n`;

			metrics.aircraftMultipliers[a] = {
				mult,
				seenPrec: seenDuringKill,
				killedPrec: killPrec,
				count: metrics.aircraftKilled[a]
			};
		});

		let totalWeaponTypesUsed = 0;
		for (const w in metrics.weaponsUsed) totalWeaponTypesUsed++;

		const expectPrec = 1 / totalWeaponTypesUsed;
		const normalizerMetricPrec = metrics.weaponsUsed[Weapon.AIM120] ? metrics.weaponsUsed[Weapon.AIM120] / metrics.totalKills : expectPrec;
		const normalizer = 1 / (expectPrec / normalizerMetricPrec);

		for (const w in metrics.weaponsUsed) {
			const weapon = +w as Weapon;

			const prec = metrics.weaponsUsed[weapon] / metrics.totalKills;
			const mult = (expectPrec / prec) * normalizer;

			console.log(` - Weapon ${Weapon[weapon]} ${(prec * 100).toFixed(2)}% of the time. Multiplier: ${mult.toFixed(2)}x`);

			resultLog += ` - Weapon ${Weapon[weapon]} - ${mult.toFixed(2)}x\n`;

			metrics.weaponMultipliers[weapon] = {
				mult,
				prec,
				count: metrics.weaponsUsed[weapon]
			};
		}
	});

	console.log(resultLog);

	// const weapons = [Weapon.Gun, Weapon.AIM120, Weapon.AIM9, Weapon.AIM7, Weapon.AIM9X, Weapon.AIRST, Weapon.HARM, Weapon.AIM9E, Weapon.AIM54];
	// aircraft.forEach(killer => {
	// 	const metrics = killCounts[killer];
	// 	aircraft.forEach(victim => {
	// 		const victimMult = metrics.aircraftMultipliers[victim].mult;
	// 		weapons.forEach(weapon => {
	// 			const weaponMult = metrics.weaponMultipliers[weapon]?.mult;
	// 			if (!weaponMult) return;

	// 			const mult = metrics.mult * victimMult * weaponMult;
	// 			const str = `${Aircraft[killer]}->${Weapon[weapon]}->${Aircraft[victim]}`;

	// 			console.log(`${mult.toFixed(1)}x ${str} (${metrics.mult} * ${victimMult} * ${weaponMult})`);
	// 		});
	// 	});
	// });

	return killCounts;
}

function metricsToStrings(metrics: Record<Aircraft, AircraftKillMetrics>) {
	const aircraft: Aircraft[] = [];
	const weapons: Weapon[] = [];

	for (const ac in Aircraft) {
		if (isNaN(+ac)) continue;
		aircraft.push(+ac as Aircraft);
	}

	for (const w in Weapon) {
		if (isNaN(+w)) continue;
		weapons.push(+w as Weapon);
	}

	const mults: { killStr: string; multiplier: number }[] = [];

	aircraft.forEach(killer => {
		const metric = metrics[killer];
		if (!metric) return;

		aircraft.forEach(victim => {
			const victimMult = metric.aircraftMultipliers[victim]?.mult;
			if (!victimMult) return;

			weapons.forEach(weapon => {
				const weaponMult = metric.weaponMultipliers[weapon]?.mult;
				if (!weaponMult) return;

				const mult = metric.mult * victimMult * weaponMult;
				const str = `${Aircraft[killer]}->${Weapon[weapon]}->${Aircraft[victim]}`;

				mults.push({ killStr: str, multiplier: mult });
			});
		});
	});

	return mults;
}

async function multWithoutTop10Comp() {
	const db = new Database(
		{
			databaseName: "vtol-server-elo",
			url: process.env.PROD_DB_URL
		},
		console.log
	);
	await db.init();
	const userDb = await db.collection<User>("users", false, "id");
	const topTenPlayers = await userDb.collection.find({ rank: { $lt: 11, $gt: 0 } }).toArray();
	const topTenPlayerIds = topTenPlayers.map(player => player.id);

	const regularMults = await calculateEloMultipliersStreamed([]);
	const multsWithoutTopTen = await calculateEloMultipliersStreamed(topTenPlayerIds);

	regularMults.sort((a, b) => b.count - a.count);
	multsWithoutTopTen.sort((a, b) => b.count - a.count);

	console.log(`Regular multipliers (with top 10):`);
	regularMults.forEach((mult, i) => {
		console.log(`${mult.multiplier.toFixed(1)}x ${mult.killStr} (${mult.count})`);
	});

	console.log(`\nMultipliers without top 10:`);
	multsWithoutTopTen.forEach((mult, i) => {
		console.log(`${mult.multiplier.toFixed(1)}x ${mult.killStr} (${mult.count})`);
	});

	console.log(`\nDifferences:`);
	regularMults.sort((a, b) => {
		const matchingMultA = multsWithoutTopTen.find(m => m.killStr == a.killStr);
		if (!matchingMultA) return 0;
		const diffA = matchingMultA.multiplier - a.multiplier;
		const diffPercentA = (diffA / a.multiplier) * 100;

		const matchingMultB = multsWithoutTopTen.find(m => m.killStr == b.killStr);
		if (!matchingMultB) return 0;
		const diffB = matchingMultB.multiplier - b.multiplier;
		const diffPercentB = (diffB / b.multiplier) * 100;

		return diffPercentB - diffPercentA;
	});
	regularMults.forEach((mult, i) => {
		const matchingMult = multsWithoutTopTen.find(m => m.killStr == mult.killStr);
		if (!matchingMult) return;
		const diff = matchingMult.multiplier - mult.multiplier;
		const diffPercent = (diff / mult.multiplier) * 100;
		// if (Math.abs(diffPercent) > 0.1) {
		console.log(
			`${mult.multiplier.toFixed(1)}x ${mult.killStr} (${mult.count}) -> ${matchingMult.multiplier.toFixed(1)}x (${
				matchingMult.count
			}) (${diffPercent.toFixed(2)}%)`
		);
		// }
	});
}

async function newMultSystem() {
	await calculateNewMultipliersStreamed([]);
}

async function newMultSystemComp() {
	const db = new Database(
		{
			databaseName: "vtol-server-elo",
			url: process.env.PROD_DB_URL
		},
		console.log
	);
	await db.init();
	const userDb = await db.collection<User>("users", false, "id");
	const topTenPlayers = await userDb.collection.find({ rank: { $lt: 11, $gt: 0 } }).toArray();
	const topTenPlayerIds = topTenPlayers.map(player => player.id);

	const regularMults = metricsToStrings(await calculateNewMultipliersStreamed([]));
	const multsWithoutTopTen = metricsToStrings(await calculateNewMultipliersStreamed(topTenPlayerIds));

	regularMults.sort((a, b) => b.multiplier - a.multiplier);
	multsWithoutTopTen.sort((a, b) => b.multiplier - a.multiplier);

	console.log(`Regular multipliers (with top 10):`);
	regularMults.forEach((mult, i) => {
		console.log(`${mult.multiplier.toFixed(1)}x ${mult.killStr}`);
	});

	console.log(`\nMultipliers without top 10:`);
	multsWithoutTopTen.forEach((mult, i) => {
		console.log(`${mult.multiplier.toFixed(1)}x ${mult.killStr}`);
	});

	console.log(`\nDifferences:`);
	regularMults.sort((a, b) => {
		const matchingMultA = multsWithoutTopTen.find(m => m.killStr == a.killStr);
		if (!matchingMultA) return 0;
		const diffA = matchingMultA.multiplier - a.multiplier;
		const diffPercentA = (diffA / a.multiplier) * 100;

		const matchingMultB = multsWithoutTopTen.find(m => m.killStr == b.killStr);
		if (!matchingMultB) return 0;
		const diffB = matchingMultB.multiplier - b.multiplier;
		const diffPercentB = (diffB / b.multiplier) * 100;

		return diffPercentB - diffPercentA;
	});
	regularMults.forEach((mult, i) => {
		const matchingMult = multsWithoutTopTen.find(m => m.killStr == mult.killStr);
		if (!matchingMult) return;
		const diff = matchingMult.multiplier - mult.multiplier;
		const diffPercent = (diff / mult.multiplier) * 100;
		// if (Math.abs(diffPercent) > 0.1) {
		console.log(`${mult.multiplier.toFixed(1)}x ${mult.killStr}  -> ${matchingMult.multiplier.toFixed(1)}x (${diffPercent.toFixed(2)}%)`);
		// }
	});
}

// multWithoutTop10Comp();
newMultSystem();
