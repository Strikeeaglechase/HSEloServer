import fs from "fs";
import path from "path";
import sharp from "sharp";
import vega from "vega";

import { AsyncProcessManager } from "../asyncProcessManager.js";
import { User } from "../structures.js";
import { comparisonGraph } from "./compare-graph.js";
import { normGraph } from "./norm-graph.js";

const eloGraphOutput = "../graphs/";

const graphConfig = {
	"background": "#333",
	"title": { "color": "#fff", "subtitleColor": "#fff" },
	"style": { "guide-label": { "fill": "#fff" }, "guide-title": { "fill": "#fff" } },
	"axis": { "domainColor": "#fff", "gridColor": "#888", "tickColor": "#fff" }
};

const graphCache = new Map<string, { time: number, path: string; }>();
const graphCacheTime = 1000 * 60 * 5; // 5 minutes

const processManager = new AsyncProcessManager<[User, User?, string?], string>(actuallyCreateUserEloGraph);

async function renderGraphSchema(schema: any, outputPath: string) {
	const view = new vega
		.View(vega.parse(schema, graphConfig))
		.renderer("none")
		.initialize();

	const svg = await view.toSVG();
	await sharp(Buffer.from(svg))
		.resize(null, 500)
		.toFormat("png")
		.toFile(outputPath);
}

const maxHistoryPoints = 250;
function reduceHistory(history: { elo: number, time: number; }[]) {
	if (history.length <= maxHistoryPoints) return history;

	const step = history.length / maxHistoryPoints;
	const windowSize = Math.max(1, Math.floor(step / 2));
	const result: { elo: number, time: number; }[] = [];
	for (let i = 0; i < history.length; i += step) {
		let idx = Math.floor(i);
		let sum = 0;
		let pts = 0;
		for (let j = idx - windowSize; j < idx + windowSize; j++) {
			if (j < 0 || j >= history.length) continue;
			sum += history[j].elo;
			pts++;
		}
		result.push({ elo: sum / pts, time: history[idx].time });
	}
	return result;
}

async function actuallyCreateUserEloGraph(user: User, userB?: User, mode?: string) {
	if (userB) return actuallyCreateCompareGraph(user, userB, mode);

	if (!fs.existsSync(eloGraphOutput)) fs.mkdirSync(eloGraphOutput, { recursive: true });
	const graphSchema = JSON.parse(JSON.stringify(normGraph));
	graphSchema.data[0].values = reduceHistory(user.eloHistory).map((elo, idx) => ({ x: idx, y: elo.elo }));

	const outputPath = `${eloGraphOutput}${user.id}.png`;
	await renderGraphSchema(graphSchema, path.join(eloGraphOutput, `${user.id}.png`));

	const finalPath = path.resolve(outputPath);
	graphCache.set(user.id, { time: Date.now(), path: finalPath });
	return finalPath;
}

async function actuallyCreateCompareGraph(userA: User, userB: User, mode: string) {
	if (!fs.existsSync(eloGraphOutput)) fs.mkdirSync(eloGraphOutput, { recursive: true });

	const graphSchema = JSON.parse(JSON.stringify(comparisonGraph));
	const allElos: { elo: number, time: number, user: number; }[] = [];
	const userAElos: { elo: number, time: number, user: number; }[] = [];
	const userBElos: { elo: number, time: number, user: number; }[] = [];
	reduceHistory(userA.eloHistory).forEach((elo, idx) => {
		allElos.push({ elo: elo.elo, time: elo.time, user: 0 });
		userAElos.push({ elo: elo.elo, time: elo.time, user: 0 });
	});
	reduceHistory(userB.eloHistory).forEach((elo, idx) => {
		allElos.push({ elo: elo.elo, time: elo.time, user: 1 });
		userBElos.push({ elo: elo.elo, time: elo.time, user: 1 });
	});

	const ratioA = userAElos.length / userBElos.length;
	const ratioB = userBElos.length / userAElos.length;

	if (mode == "time") {
		graphSchema.data[0].values = allElos.sort((a, b) => a.time - b.time).map((elo, idx) => { return { x: elo.time, y: elo.elo, player: elo.user }; });
	} else {
		let result = [];
		userAElos.forEach((elo, idx) => {
			result.push({ x: idx * ratioB, y: elo.elo - 10, player: elo.user });
		});
		userBElos.forEach((elo, idx) => {
			result.push({ x: idx * ratioA, y: elo.elo, player: elo.user });
		});
		graphSchema.data[0].values = result;
	}

	const outputPath = `${eloGraphOutput}${userA.id}-${userB.id}.png`;
	await renderGraphSchema(graphSchema, path.join(eloGraphOutput, `${userA.id}-${userB.id}.png`));
	return path.resolve(outputPath);
}

export async function createUserEloGraph(user: User) {
	if (graphCache.has(user.id) && graphCache.get(user.id).time + graphCacheTime > Date.now()) return graphCache.get(user.id).path;
	return processManager.execute(user.id, user);
}

export async function createCompareGraph(userA: User, userB: User, mode: "stretch" | "time") {
	const id = `${userA.id}-${userB.id}`;
	if (graphCache.has(id) && graphCache.get(id).time + graphCacheTime > Date.now()) return graphCache.get(id).path;
	return processManager.execute(id, userA, userB, mode);
}
