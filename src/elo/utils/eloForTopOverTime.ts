import fs from "fs";

import { User } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

class TopEloOverTimeUpdater extends ProdDBBackUpdater {
	public topTenElosOverTime: Record<string, number[]> = {};
	public numUsersOvert2000: Record<string, number> = {};

	private currentDay: string;

	private topPlayers: User[] = [];
	public topLog: string[] = [];

	protected override onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		if (event.type != "kill") return;
		if (!this.currentDay) this.currentDay = this.day(event.time);

		if (this.topPlayers.includes(user)) {
			this.topPlayers.sort((a, b) => b.elo - a.elo);
			let logStr = `${new Date(event.time).toISOString()}`;
			this.topPlayers.forEach(u => {
				logStr += `,${u.elo}`;
			});
			this.topLog.push(logStr);
		}

		const day = this.day(event.time);
		if (day != this.currentDay) {
			this.currentDay = day;
			this.updateHistoryAvg();
		}
	}

	private updateHistoryAvg() {
		this.users.sort((a, b) => b.elo - a.elo);
		const topUsers = this.users.slice(0, 20);
		const topElos = topUsers.map(u => u.elo);
		this.topTenElosOverTime[this.currentDay] = topElos;
		this.topPlayers = topUsers;

		const numUsersOvert2000 = this.users.filter(u => u.elo > 2000).length;
		this.numUsersOvert2000[this.currentDay] = numUsersOvert2000;
	}

	private day(time: number) {
		return new Date(time).toISOString().substring(0, 10);
	}
}

async function run() {
	const updater = new TopEloOverTimeUpdater();
	await updater.runBackUpdate();

	let result = "";
	Object.entries(updater.numUsersOvert2000).forEach(([ts, elo]) => {
		result += `${ts},${elo}\n`;
	});

	let resultAvg = "";
	Object.entries(updater.topTenElosOverTime).forEach(([ts, elo]) => {
		resultAvg += `${ts},${elo.join(",")}\n`;
	});

	fs.writeFileSync("../../../out.csv", result);
	fs.writeFileSync("../../../out-avg.csv", resultAvg);
	fs.writeFileSync("../../../out-big.csv", updater.topLog.join("\n"));
}

run();
