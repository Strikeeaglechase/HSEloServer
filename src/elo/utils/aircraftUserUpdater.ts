import { Aircraft, Kill, Weapon } from "../../structures.js";
import { BASE_ELO, ELOUpdater } from "../eloUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

interface ACUser {
	aircraft: Aircraft;
	elo: number;
	kills: number;
	deaths: number;
	selfKills: number;
}

class AircraftUserUpdater extends ProdDBBackUpdater {
	private acUsers: ACUser[] = [];
	private acUsersMap: Record<Aircraft, ACUser> = {} as any;

	private setupAcUsers() {
		const createUser = (ac: Aircraft) => {
			const newUser: ACUser = {
				aircraft: ac,
				elo: BASE_ELO,
				kills: 0,
				deaths: 0,
				selfKills: 0
			};
			this.acUsers.push(newUser);
			this.acUsersMap[ac] = newUser;
		};

		createUser(Aircraft.FA26b);
		createUser(Aircraft.F45A);
		createUser(Aircraft.T55);
	}

	public override async runBackUpdate(): Promise<void> {
		this.setupAcUsers();

		const start = Date.now();
		await this.setupBackUpdate();
		console.log(`Setup completed, starting main calculation`);

		for (let i = 0; i < this.events.length; i++) {
			const e = this.events[i];

			const timestamp = new Date(e.time).toISOString();
			if (e.type == "kill") {
				const kill = e.event as Kill;

				if (kill.killer.type == Aircraft.Invalid || kill.victim.type == Aircraft.Invalid) continue;
				if (kill.weapon == Weapon.CFIT || kill.weapon == Weapon.DCCFIT) continue;
				if (kill.killer.type == kill.victim.type) {
					this.acUsersMap[kill.killer.type].selfKills++;
					continue;
				}

				const killer = this.acUsersMap[kill.killer.type];
				const victim = this.acUsersMap[kill.victim.type];
				const aircraftOffset = ELOUpdater.getKillAircraftOffset(kill);
				const eloSteal = ELOUpdater.calculateEloSteal(killer.elo, victim.elo, aircraftOffset, 1);

				killer.elo += eloSteal;
				victim.elo -= eloSteal;
				victim.elo = Math.max(victim.elo, 1);
				killer.kills++;
				victim.deaths++;
			}
		}

		console.log(`Primary back update calculations done! Took ${Date.now() - start}ms`);
	}

	public log() {
		console.log(JSON.stringify(this.acUsers, null, 2));
	}
}

async function runAircraftUserUpdater() {
	const updater = new AircraftUserUpdater();
	await updater.runBackUpdate();
	updater.log();
}

runAircraftUserUpdater();
