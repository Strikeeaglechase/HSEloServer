import { Kill, Weapon } from "../../structures.js";
import { loadFileStreamedCb, loadFileStreamedNoParseCb } from "./eloUtils.js";

async function run() {
	const weaponKills: Record<Weapon, number> = {} as Record<Weapon, number>;
	const weaponFired: Record<Weapon, number> = {} as Record<Weapon, number>;

	await loadFileStreamedNoParseCb("../../../prodHourlyReport/missiles.json", (data: string) => {
		// const typeIdx = data.indexOf(`"type":`);
		// const commaIdx = data.indexOf(`,`, typeIdx + 7);
		// const type = +data.substring(typeIdx + 7, commaIdx) as Weapon;

		// console.log(data.substring(0, 128), type);

		const missile = JSON.parse(data);
		const type = missile.type;

		if (!weaponFired[type]) weaponFired[type] = 0;
		weaponFired[type]++;
	});

	console.log(weaponFired);
	// process.exit(0);

	await loadFileStreamedCb<Kill>("../../../prodHourlyReport/kills.json", kill => {
		// if (kill.weapon == Weapon.MALD) {
		// 	console.log(kill);
		// 	process.exit();
		// }
		weaponKills[kill.weapon] = (weaponKills[kill.weapon] || 0) + 1;
	});

	console.log(weaponKills);

	for (const [w, count] of Object.entries(weaponFired)) {
		const weapon = +w as Weapon;

		const kills = weaponKills[weapon] || 0;
		const shots = count || 0;
		const pk = kills / shots;

		console.log(`Weapon ${Weapon[weapon]} has ${kills} kills, ${shots} shots, ${pk.toFixed(4)} pk`);
	}
}

run();
