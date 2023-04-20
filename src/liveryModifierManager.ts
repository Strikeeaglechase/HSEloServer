import { fork } from "child_process";

import { Application } from "./application.js";
import { Aircraft, User } from "./structures.js";

const cacheTime = 1000 * 60 * 60; // 1 hour

interface LiveryModifierTask {
	user: User;
	liveryId: string;
	aircraft: Aircraft;
	kills: number;
	time: number;
	resolver: (resultId: string) => void;
	resultId: string;
}

class LiveryModifierManager {
	private tasks: LiveryModifierTask[] = [];
	private cache: LiveryModifierTask[] = [];
	private runningTask: LiveryModifierTask;

	constructor(private app: Application) {
		this.process();
	}

	private async process() {
		if (this.tasks.length == 0) return setTimeout(() => this.process(), 250);

		const task = this.tasks.shift();
		this.runningTask = task;
		this.app.log.info(`Processing livery modification for ${task.user.pilotNames[0]} (${task.user.id})...`);
		await new Promise<void>(res => {
			const child = fork("./liveryModifier.js", [
				process.env.STEAM_USER,
				process.env.STEAM_PASS,
				task.user.pilotNames[0],
				task.user.id,
				task.liveryId,
				Aircraft[task.aircraft],
				task.kills.toString()
			], {
				stdio: ["pipe", "pipe", "pipe", "ipc"]
			});

			let hasRes = false;
			child.stdout.on("data", data => {
				const msg = (data.toString() as string).trim();
				this.app.log.info(`[LiveryModifier] ${msg}`);
				if (msg.includes("RESULT: ")) {
					const resultId = msg.match(/RESULT: (\d+)/)[1];
					task.resultId = resultId;
					task.resolver(resultId);
					this.runningTask = null;
					this.cache.push(task);
					this.app.log.info(`Livery modification for ${task.user.pilotNames[0]} (${task.user.id}) finished with result ID ${resultId}`);
					hasRes = true;
					res();
				}
			});

			child.on("close", () => {
				if (!hasRes) {
					res();
					hasRes = true;
				}
			});
		});

		this.app.log.info(`Finished processing livery modification for ${task.user.pilotNames[0]} (${task.user.id})`);
		this.process();
	}

	public addTask(user: User, aircraft: Aircraft, liveryId: string, kills: number): Promise<string> {
		if (this.runningTask && this.runningTask.user.id == user.id) {
			console.log(`Skipping livery modification for ${user.pilotNames[0]} (${user.id}) because it's already running`);
			return;
		}

		const existing = this.cache.find(t => t.user.id === user.id && t.liveryId === liveryId);
		if (existing) {
			const td = Date.now() - existing.time;
			if (td < cacheTime) {
				return new Promise(res => res(existing.resultId));
			}
		}

		return new Promise(res => {
			this.tasks.push({
				user: user,
				liveryId: liveryId,
				kills: kills,
				aircraft: aircraft,
				time: Date.now(),
				resolver: res,
				resultId: ""
			});
		});
	}
}

export { LiveryModifierManager };