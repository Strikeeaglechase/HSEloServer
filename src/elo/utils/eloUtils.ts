import { config } from "dotenv";
import fs from "fs";
import path from "path";

import Database from "../../db/database.js";
import { Death, Kill } from "../../structures.js";
import { EloBackUpdater } from "../eloBackUpdater.js";

config({ path: "../../.env" });
const hourlyReportPath = "../../../prodHourlyReport";

class ProdDBBackUpdater extends EloBackUpdater {
	protected reportPath: string = hourlyReportPath;

	protected override async loadDb() {
		this.db = new Database(
			{
				databaseName: "vtol-server-elo",
				url: process.env.PROD_DB_URL
			},
			console.log
		);

		await this.db.init();
		this.userDb = await this.db.collection("users", false, "id");
		this.seasons = await this.db.collection("seasons", false, "id");
	}

	protected async loadFromHourlyReport() {
		console.log(`Loading from hourly report...`);
		this.kills = await this.loadFileStreamed<Kill>(`${this.reportPath}/kills.json`);
		this.deaths = await this.loadFileStreamed<Death>(`${this.reportPath}/deaths.json`);

		console.log(`Loaded ${this.kills.length} kills and ${this.deaths.length} deaths.`);
	}
}

class ComparisonUpdater extends ProdDBBackUpdater {
	public async runCompare() {
		// Compare the locally computed elo to the current elo in the database
		const currentDbUsers = await this.userDb.collection.find({ $or: [{ deaths: { $gt: 0 } }, { elo: { $ne: 2000 } }] }).toArray();
		console.log(`Loaded ${currentDbUsers.length} users from the database.`);
		currentDbUsers.forEach(user => {
			const localUser = this.usersMap[user.id];
			if (!localUser) {
				console.log(`User ${user.pilotNames[0]} (${user.id}) not found in local data.`);
				return;
			}

			if (Math.abs(localUser.elo - user.elo) > 25) {
				console.log(`${user.pilotNames[0]} (${user.id}). ${user.elo.toFixed(0)} -> ${localUser.elo.toFixed(0)}`);
			}
		});

		const u = this.usersMap["76561199442641427"];
		fs.writeFileSync("../../out-log.txt", u.history.join("\n"));
	}
}

async function createPullStream(db: Database, collectionName: string, fileName: string, filter: any) {
	const resultPath = `${hourlyReportPath}/${fileName}.json`;
	if (fs.existsSync(resultPath)) fs.rmSync(resultPath);

	console.log(`Pulling ${collectionName} to ${path.resolve(resultPath)}`);

	const collection = await db.collection(collectionName, false, "id");
	const writeStream = fs.createWriteStream(resultPath);

	const prom = new Promise(res => writeStream.on("finish", res));

	collection.collection
		.find(filter)
		.stream()
		.on("data", data => writeStream.write(JSON.stringify(data) + "\n"))
		.on("end", () => writeStream.end());

	await prom;
}

async function pullOfflineLoad() {
	if (!fs.existsSync(hourlyReportPath)) fs.mkdirSync(hourlyReportPath);
	console.log(`Writing hourly report to ${hourlyReportPath}`);

	const db = new Database(
		{
			databaseName: "vtol-server-elo",
			url: process.env.PROD_DB_URL
		},
		console.log
	);
	await db.init();
	const proms = [
		createPullStream(db, "kills-v2", "kills", { season: 3 }),
		createPullStream(db, "deaths-v2", "deaths", { season: 3 }),
		createPullStream(db, "users", "users", {})
	];
	await Promise.all(proms);

	console.log(`Wrote hourly report finished!`);
}

async function runComparison() {
	const updater = new ComparisonUpdater();
	await updater.runBackUpdate();
	await updater.runCompare();
}

export { ProdDBBackUpdater };

// getInterestingMetrics();
runComparison();
// pullOfflineLoad();
