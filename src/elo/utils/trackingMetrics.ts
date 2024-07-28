import fs from "fs";
import JSONStream from "JSONStream";

function convertToJsonL(inputPath: string, outputPath: string) {
	const inputFile = fs.createReadStream(inputPath, "utf8");
	const outputFile = fs.createWriteStream(outputPath, "utf8");

	let processed = 0;
	inputFile.pipe(JSONStream.parse("*")).on("data", data => {
		processed++;
		outputFile.write(JSON.stringify(data) + "\n");

		if (processed % 100_000 == 0) {
			console.log(`Processed ${processed / 1000}k events`);
		}
	});
}

function loadFileStreamed(path: string, cb: (data: string) => void) {
	const readStream = fs.createReadStream(path);
	return new Promise<void>(res => {
		let remaining = "";

		readStream.on("data", data => {
			const parts = (remaining + data).split("\n");
			remaining = parts.pop();

			parts.forEach(part => cb(part));
		});

		readStream.on("end", () => {
			if (remaining.length > 0) cb(remaining);
			res();
		});
	});
}
// time_of_day, mission, client_join, valid_nid, log_message, net_instantiate, slot_request, landing, takeoff, workshop_livery, client_leave, builtin_livery, achievement_grant, banned_user_join, fire_missile, pitbull, cms, missile_detonate, damage, spawncamp_warning, purchase, eject, intercept, aircraft_collision, teamkill_kick, missile_spawncamp_delete, crew_kick, invalid_user_nid, nid_timeout, high_ping_disconnect
let totalCount = 0;
function handleTrackingData(dataStr: string) {
	if (dataStr.includes("net_instantiate") && dataStr.includes("Vehicles/")) {
		// const data = JSON.parse(dataStr);
		// if (data.type == "net_instantiate") {
		totalCount++;
		// }
	}
}

function handleMissileData(dataStr: string) {
	// console.log(dataStr);
	if (
		dataStr.includes(`"type":6,"team":`)
		// dataStr.includes(`"type":4,"team":`) ||
		// dataStr.includes(`"type":5,"team":`) ||
		// dataStr.includes(`"type":8,"team":`)
	) {
		// const data = JSON.parse(dataStr)
		totalCount++;
	}
}

// convertToJsonL("../../../prodHourlyReport/vtol-server-elo.missiles.json", "../../../prodHourlyReport/missiles.json");

async function run() {
	let start = Date.now();
	// await loadFileStreamed("../../../prodHourlyReport/trackingOutput.json", handleTrackingData);
	await loadFileStreamed("../../../prodHourlyReport/missiles.json", handleMissileData);
	console.log("Done");
	console.log(`Took ${Date.now() - start}ms`);
	console.log(`Count: ${totalCount}`);
}

run();
