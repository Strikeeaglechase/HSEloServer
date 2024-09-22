import { config } from "dotenv";
import fs from "fs";
import path from "path";

import Database from "../../db/database.js";
import { Death, Kill, User } from "../../structures.js";
import { EloBackUpdater } from "../eloBackUpdater.js";

config({ path: "../../.env" });
const hourlyReportPath = "../../../prodHourlyReport";

class ProdDBBackUpdater extends EloBackUpdater {
	protected reportPath: string = hourlyReportPath;

	public override async loadDb() {
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
		currentDbUsers.sort((a, b) => b.elo - a.elo);
		console.log(`Loaded ${currentDbUsers.length} users from the database.`);
		const results: { user: User; oldElo: number; newElo: number }[] = [];

		let biggestGain: { user: User; gain: number } = { user: null, gain: 0 };
		let biggestLoss: { user: User; loss: number } = { user: null, loss: 0 };

		currentDbUsers.forEach(user => {
			const localUser = this.usersMap[user.id];
			if (!localUser) {
				console.log(`User ${user.pilotNames[0]} (${user.id}) not found in local data.`);
				return;
			}

			if (Math.abs(localUser.elo - user.elo) > 25) {
				console.log(`${user.pilotNames[0]} (${user.id}). ${user.elo.toFixed(0)} -> ${localUser.elo.toFixed(0)}`);
			}

			const eloDelta = localUser.elo - user.elo;
			if (eloDelta > biggestGain.gain) {
				biggestGain = { user: user, gain: eloDelta };
			} else if (eloDelta < biggestLoss.loss) {
				biggestLoss = { user: user, loss: eloDelta };
			}

			results.push({ user: user, oldElo: user.elo, newElo: localUser.elo });
		});

		results.sort((a, b) => b.newElo - a.newElo);
		for (let i = 0; i < 30; i++) {
			const orgRank = currentDbUsers.findIndex(u => u.id === results[i].user.id);
			const oldElo = results[i].oldElo.toFixed(0);
			const newElo = results[i].newElo.toFixed(0);
			console.log(`${orgRank + 1} -> ${i + 1}) ${results[i].user.pilotNames[0]} (${results[i].user.id}). ${oldElo} -> ${newElo}`);
		}

		console.log(
			`Biggest gain: ${biggestGain.user.pilotNames[0]} (${biggestGain.user.id}). ${biggestGain.user.elo.toFixed(0)} +${biggestGain.gain.toFixed(0)}`
		);
		console.log(
			`Biggest loss: ${biggestLoss.user.pilotNames[0]} (${biggestLoss.user.id}). ${biggestLoss.user.elo.toFixed(0)} ${biggestLoss.loss.toFixed(0)}`
		);

		const u = this.usersMap["76561199775327193"];
		fs.writeFileSync("../../../out-log.txt", u.history.join("\n"));
	}
}

async function createPullStream(db: Database, collectionName: string, fileName: string, filter: any) {
	const resultPath = `${hourlyReportPath}/${fileName}.json`;
	if (fs.existsSync(resultPath)) fs.rmSync(resultPath);

	console.log(`Pulling ${collectionName} to ${path.resolve(resultPath)}`);

	const collection = await db.collection(collectionName, false, "id");
	const writeStream = fs.createWriteStream(resultPath);

	const prom = new Promise(res => writeStream.on("finish", res));

	let c = 0;
	collection.collection
		.find(filter)
		.stream()
		.on("data", data => {
			writeStream.write(JSON.stringify(data) + "\n");
			c++;
		})
		.on("end", () => writeStream.end());

	await prom;

	return c;
}

async function pullOfflineLoad(filter: any) {
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
		createPullStream(db, "kills-v2", "kills", filter),
		createPullStream(db, "deaths-v2", "deaths", filter),
		createPullStream(db, "users", "users", {})
	];
	await Promise.all(proms);

	console.log(`Wrote hourly report finished!`);
}

function loadFileStreamed<T>(path: string): Promise<T[]> {
	const readStream = fs.createReadStream(path);
	return new Promise(res => {
		let remaining = "";
		const result: T[] = [];

		readStream.on("data", data => {
			const parts = (remaining + data).split("\n");
			remaining = parts.pop();

			parts.forEach(part => result.push(JSON.parse(part)));
		});

		readStream.on("end", () => {
			if (remaining.length > 0) result.push(JSON.parse(remaining));
			res(result);
		});
	});
}

async function runComparison() {
	const updater = new ComparisonUpdater();
	await updater.runBackUpdate();
	await updater.runCompare();
}

export { ProdDBBackUpdater, createPullStream, loadFileStreamed };

// getInterestingMetrics();
runComparison();
// pullOfflineLoad({ season: 4 });
