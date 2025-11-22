import fs from "fs";

import { getRandomEnv } from "../../serverEnvProfile.js";
import { RandomEnv } from "../../structures.js";
import { Tracking } from "../../structures.js";

function countTimes(envs: RandomEnv[]) {
	const tods = new Array(23).fill(0);

	envs.forEach(env => {
		tods[env.tod]++;
	});

	return tods;
}

function run() {
	const serverEnvsTracking = JSON.parse(fs.readFileSync("../../../prodHourlyReport/vtol-server-elo.tracking.json", "utf-8"));

	const serverEnvs: (RandomEnv & { eventTime: number })[] = serverEnvsTracking.map((env: Tracking) => {
		return {
			...JSON.parse(env.args[0]),
			eventTime: env.time
		};
	});

	console.log(`Loaded ${serverEnvs.length} server envs`);
	const thresholdDate = new Date("2024-09-22T00:00:00.000Z").getTime();
	const before = serverEnvs.filter(env => env.eventTime < thresholdDate);
	const after = serverEnvs.filter(env => env.eventTime >= thresholdDate);

	console.log(`Before update: ${before.length}`);
	console.log(`After update: ${after.length}`);

	const beforeTods = countTimes(before);
	const afterTods = countTimes(after);

	console.log("Before update:");
	console.log(beforeTods.join(","));
	console.log("After update:");
	console.log(afterTods.join(","));
}

run();
