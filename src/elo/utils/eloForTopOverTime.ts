import fs from "fs";

import { User } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

class TopEloOverTimeUpdater extends ProdDBBackUpdater {
	private currentTopElo: number = 2000;
	private currentTopUser: User;

	public history: Record<string, number> = {};
	public historyAvg: Record<string, number> = {};
	public numUsersOvert2000: Record<string, number> = {};

	private currentDay: string;

	protected override onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		if (event.type != "kill") return;
		if (!this.currentTopUser) this.currentTopUser = user;
		if (!this.currentDay) this.currentDay = this.day(event.time);

		if (user.id != this.currentTopUser.id) {
			if (user.elo > this.currentTopElo) {
				this.currentTopElo = user.elo;
				this.currentTopUser = user;
			}
		} else {
			if (event.event.killer.ownerId == this.currentTopUser.id) {
				this.currentTopElo = user.elo;
			} else {
				// Top user died, find new top user
				const possibleUsers = this.users.filter(u => u.elo > this.currentTopElo - 500);
				let newTopUser: User;
				let newTopElo = 0;
				for (const u of possibleUsers) {
					if (u.elo > newTopElo) {
						newTopElo = u.elo;
						newTopUser = u;
					}
				}

				this.currentTopElo = newTopElo;
				this.currentTopUser = newTopUser;
			}
		}

		this.pushHistory(event.time);

		const day = this.day(event.time);
		if (day != this.currentDay) {
			this.currentDay = day;
			this.updateHistoryAvg();
		}
	}

	private updateHistoryAvg() {
		this.users.sort((a, b) => b.elo - a.elo);
		const topUsers = this.users.slice(0, 10);
		let sum = 0;
		for (const u of topUsers) {
			sum += u.elo;
		}
		sum /= topUsers.length;

		this.historyAvg[this.currentDay] = sum;

		const numUsersOvert2000 = this.users.filter(u => u.elo > 2000).length;
		this.numUsersOvert2000[this.currentDay] = numUsersOvert2000;
	}

	private day(time: number) {
		return new Date(time).toISOString().substring(0, 10);
	}

	private pushHistory(time: number) {
		const ts = new Date(time).toISOString().substring(0, 10);
		this.history[ts] = this.currentTopElo;
	}
}

async function run() {
	const updater = new TopEloOverTimeUpdater();
	updater.history["2023-04-11"] = 2000;
	await updater.runBackUpdate();

	let result = "";
	Object.entries(updater.numUsersOvert2000).forEach(([ts, elo]) => {
		result += `${ts},${elo}\n`;
	});

	let resultAvg = "";
	Object.entries(updater.historyAvg).forEach(([ts, elo]) => {
		resultAvg += `${ts},${elo}\n`;
	});

	fs.writeFileSync("../../../out.csv", result);
	fs.writeFileSync("../../../out-avg.csv", resultAvg);
}

run();
