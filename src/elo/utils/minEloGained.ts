import { User } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

class MinEloGainedUpdater extends ProdDBBackUpdater {
	protected override onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		// if (event.type != "kill") return;
		// if (event.event.killer.ownerId != user.id) return;
		// if (eloDelta === 0) return;
		// // if (!user.pilotNames.some(pt => pt.includes("C0D3"))) return;
		// if (eloDelta < this.currentMinEloGained) {
		// 	this.currentMinEloGained = eloDelta;
		// 	this.currentMinUser = user;
		// }
		//
		// if (eloDelta > this.maxEloGained) {
		// 	this.maxEloGained = eloDelta;
		// 	this.maxEloGainedUser = user;
		// }
	}

	public print() {
		const eloCounts: Record<number, number> = {};
		for (const user of this.users) {
			const elo = Math.floor(user.elo / 100) * 100;
			if (!eloCounts[elo]) eloCounts[elo] = 0;
			eloCounts[elo]++;
		}

		const eloCountsArr = Object.entries(eloCounts).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));

		console.log(eloCountsArr.map(c => `${c[0]}, ${c[1]}`).join("\n"));
	}
}

async function run() {
	const updater = new MinEloGainedUpdater();
	await updater.runBackUpdate();
	updater.print();
}

run();
