import fs from "fs";

import { Aircraft, User, Weapon } from "../../structures.js";
import { EloEvent } from "../eloBackUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

class MasterLogGeneratorUpdater extends ProdDBBackUpdater {
	private writeStream = fs.createWriteStream("../../master-log.txt");

	protected onUserUpdate(user: User, event: EloEvent, eloDelta: number): void {
		super.onUserUpdate(user, event, eloDelta);
		let log = `[${new Date(event.time).toISOString()}][${event.type.toUpperCase().padEnd(6)}] `;
		switch (event.type) {
			case "action":
				log += `User ${user.pilotNames[0]} (${user.id}) ${event.event.action == "Login" ? "logged in" : "logged out"}.`;
				break;

			case "kill":
				const kill = event.event;
				const wpnStr = `${Aircraft[kill.killer.type]}->${Weapon[kill.weapon]}->${Aircraft[kill.victim.type]}`;
				if (kill.killer.ownerId == user.id) {
					log += `Killer: ${user.pilotNames[0]} (${user.id}) with ${wpnStr} gained ${eloDelta.toFixed(0)}, new elo: ${user.elo.toFixed(0)}.`;
				} else {
					log += `Victim: ${user.pilotNames[0]} (${user.id}) killed by ${wpnStr}, lost ${eloDelta.toFixed(0)}, new elo: ${user.elo.toFixed(0)}.`;
				}
				break;
			case "death":
				log = "";
		}

		if (log.length > 0) this.writeStream.write(log + "\n");
	}
}

async function generateMasterLog() {
	const updater = new MasterLogGeneratorUpdater();

	await updater.runBackUpdate();
}

generateMasterLog();
