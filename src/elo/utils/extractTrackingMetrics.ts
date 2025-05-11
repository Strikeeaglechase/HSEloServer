import { Tracking } from "../../structures.js";
import { loadFileStreamedNoParseCb } from "./eloUtils.js";

async function calculateInterceptStats() {
	let c = 0;
	const counts: Record<string, number> = {};
	const missilesShot: Record<string, number> = {};

	await loadFileStreamedNoParseCb("../../../prodHourlyReport/missiles.json", (data: string) => {
		c++;

		const ownerIdx = data.indexOf(`"ownerId":"`);
		const endQuoteIdx = data.indexOf(`"`, ownerIdx + 11);
		const ownerId = data.substring(ownerIdx + 11, endQuoteIdx);
		if (!missilesShot[ownerId]) missilesShot[ownerId] = 0;
		missilesShot[ownerId]++;
	});

	console.log({ c });

	await loadFileStreamedNoParseCb("../../../prodHourlyReport/tracking/intercept.json", (data: string) => {
		const interceptAttempt: Tracking = JSON.parse(data);
		const [_, __, userId] = interceptAttempt.args;

		if (!counts[userId]) counts[userId] = 0;
		counts[userId]++;
	});

	console.log(missilesShot["76561198283629625"]);
	Object.entries(counts)
		.map(([userId, count]) => ({ userId, count }))
		.map(obj => ({ ...obj, interceptsPerMissile: obj.count / (missilesShot[obj.userId] || 1) }))
		.sort((a, b) => b.interceptsPerMissile - a.interceptsPerMissile)
		.slice(0, 10)
		.forEach(stats => {
			const shots = missilesShot[stats.userId] || 0;
			console.log(
				`User ${stats.userId} has ${stats.count} intercepts, ${shots} missiles shot, ${stats.interceptsPerMissile.toFixed(4)} intercepts per missile`
			);
		});

	// console.log(c);
}

async function getIrMissileStats() {
	const missiles = ["AIRS-T", "AIM-9", "AIM-9+", "AIM-9E"];
	let irsFired = 0;
	await loadFileStreamedNoParseCb("../../../prodHourlyReport/tracking/fire_missile.json", (data: string) => {
		if (missiles.some(m => data.includes(m))) {
			irsFired++;
		}
	});

	let cms = 0;
	await loadFileStreamedNoParseCb("../../../prodHourlyReport/tracking/cms.json", (data: string) => {
		cms++;
	});

	console.log(`There were ${irsFired} IR missiles fired and ${cms} CMS fired`);
	console.log(`There were ${cms / irsFired} CMS per IR missile fired`);
}

// getIrMissileStats();
calculateInterceptStats();
