import fs from "fs";

import Database from "./db/database.js";
import { EloBackUpdater } from "./eloBackUpdater.js";
import { Death, Kill } from "./structures.js";

const hourlyReportPath = "../prodHourlyReport";

class CustomUpdater extends EloBackUpdater {
	protected override async loadDb() {
		this.db = new Database({
			databaseName: "vtol-server-elo",
			url: process.env.PROD_DB_URL
		}, console.log);

		await this.db.init();
		this.userDb = await this.db.collection("users", false, "id");
		this.seasons = await this.db.collection("seasons", false, "id");
	}

	protected async loadFromHourlyReport() {
		console.log(`Loading from hourly report...`);
		this.kills = await this.loadFileStreamed<Kill>(`${hourlyReportPath}/kills.json`);
		this.deaths = await this.loadFileStreamed<Death>(`${hourlyReportPath}/deaths.json`);

		console.log(`Loaded ${this.kills.length} kills and ${this.deaths.length} deaths.`);
	}

	public async runCompare() {
		// Compare the locally computed elo to the current elo in the database
		const currentDbUsers = await this.userDb.collection.find({}).toArray();
		currentDbUsers.forEach((user) => {
			const localUser = this.usersMap[user.id];

			if (Math.abs(localUser.elo - user.elo) > 10) {
				console.log(`User ${user.pilotNames[0]} (${user.id}). ${user.elo} -> ${localUser.elo}`);
			}
		});

		const u = this.usersMap["76561198087132420"];
		fs.writeFileSync("../out-log.txt", u.history.join("\n"));
	}
}

async function writeHourlyReport() {
	if (!fs.existsSync(hourlyReportPath)) fs.mkdirSync(hourlyReportPath);
	if (fs.existsSync(`${hourlyReportPath}/kills.json`)) fs.rmSync(`${hourlyReportPath}/kills.json`);
	if (fs.existsSync(`${hourlyReportPath}/deaths.json`)) fs.rmSync(`${hourlyReportPath}/deaths.json`);
	console.log(`Writing hourly report to ${hourlyReportPath}`);

	const db = new Database({
		databaseName: "vtol-server-elo",
		url: process.env.PROD_DB_URL
	}, console.log);
	await db.init();
	const kills = await db.collection("kills-v2", false, "id");
	const deaths = await db.collection("deaths-v2", false, "id");

	const killsStream = fs.createWriteStream(`${hourlyReportPath}/kills.json`);
	const deathsStream = fs.createWriteStream(`${hourlyReportPath}/deaths.json`);
	const proms = [
		new Promise(res => killsStream.on("finish", res)),
		new Promise(res => deathsStream.on("finish", res))
	];

	kills.collection.find({}).stream().on("data", (kill) => killsStream.write(JSON.stringify(kill) + "\n")).on("end", () => killsStream.end());
	deaths.collection.find({}).stream().on("data", (death) => deathsStream.write(JSON.stringify(death) + "\n")).on("end", () => deathsStream.end());

	await Promise.all(proms);

	console.log(`Wrote hourly report finished!`);
}

// writeHourlyReport();

async function run() {
	const updater = new CustomUpdater();
	await updater.runBackUpdate();
	await updater.runCompare();
}

run();