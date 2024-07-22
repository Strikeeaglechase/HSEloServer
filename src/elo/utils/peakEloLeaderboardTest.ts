import { User } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

class PeakEloLeaderboardUpdater extends ProdDBBackUpdater {
	private userMaxElo: Record<string, number> = {};

	protected override onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		super.onUserUpdate(user, event, eloDelta);

		if (!this.userMaxElo[user.id] || user.elo > this.userMaxElo[user.id]) {
			this.userMaxElo[user.id] = user.elo;
		}
	}

	public print() {
		const regularLeaderboard = this.users.toSorted((a, b) => b.elo - a.elo);
		const peakLeaderboard = this.users.toSorted((a, b) => this.userMaxElo[b.id] - this.userMaxElo[a.id]);

		peakLeaderboard.slice(0, 150).forEach((user, i) => {
			const currentPlace = regularLeaderboard.findIndex(u => u.id === user.id);
			console.log(`${currentPlace + 1} -> ${i + 1}) ${user.pilotNames[0]} (${user.id}). ${user.elo.toFixed(0)} -> ${this.userMaxElo[user.id].toFixed(0)}`);
		});
	}
}

async function run() {
	const updater = new PeakEloLeaderboardUpdater();
	await updater.runBackUpdate();
	updater.print();
}

run();
