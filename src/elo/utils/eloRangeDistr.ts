import { User } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

const targetUserId = "76561198200904090";
class EloRangeDistributionUpdater extends ProdDBBackUpdater {
	private rangeBuckets: Record<number, { gain: number; loss: number; kills: number; deaths: number }> = {};

	public override onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		super.onUserUpdate(user, event, eloDelta);

		if (user.id != targetUserId || event.type != "kill") return;
		// const eloChange = eloDelta * (event.event.killer.ownerId == targetUserId ? 1 : -1);

		const kill = event.event;
		const dx = kill.killer.position.x - kill.victim.position.x;
		const dy = kill.killer.position.y - kill.victim.position.y;
		const dz = kill.killer.position.z - kill.victim.position.z;
		const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

		const bucket = Math.floor(dist / 1000) * 1000;
		if (!this.rangeBuckets[bucket]) this.rangeBuckets[bucket] = { gain: 0, loss: 0, kills: 0, deaths: 0 };

		if (event.event.killer.ownerId == targetUserId) {
			this.rangeBuckets[bucket].gain += eloDelta;
			this.rangeBuckets[bucket].kills++;
		} else {
			this.rangeBuckets[bucket].loss -= eloDelta;
			this.rangeBuckets[bucket].deaths--;
		}
	}

	public log() {
		const buckets = Object.entries(this.rangeBuckets).map(([bucket, elo]) => ({ bucket: parseInt(bucket), elo }));
		buckets.sort((a, b) => a.bucket - b.bucket);
		buckets.forEach(b => console.log(`${b.bucket}, ${b.elo.gain}, ${b.elo.loss}`));
	}
}

async function eloRangeDistributionUpdater() {
	const updater = new EloRangeDistributionUpdater();
	await updater.runBackUpdate();
	updater.log();
}

eloRangeDistributionUpdater();
