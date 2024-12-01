import { Aircraft, Kill, Weapon } from "../../structures.js";
import { loadFileStreamed } from "./eloUtils.js";

async function run() {
	const counts: Record<string, number> = {};

	const kills = await loadFileStreamed<Kill>(`../../../prodHourlyReport/kills.json`);

	kills.forEach(kill => {
		const str = `${Aircraft[kill.killer.type]} -> ${Weapon[kill.weapon]} -> ${Aircraft[kill.victim.type]}`;
		if (!counts[str]) counts[str] = 0;
		counts[str]++;
	});

	const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	sorted.forEach(([str, count]) => {
		console.log(`${str}: ${count}`);
	});
}

run();
