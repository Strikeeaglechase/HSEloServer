import fs from "fs";
import path from "path";
import sharp from "sharp";
import vega from "vega";

import { AsyncProcessManager } from "./asyncProcessManager.js";
import { User } from "./structures.js";

const eloGraphOutput = "../graphs/";

const graphSchema: vega.Spec = {
	"$schema": "https://vega.github.io/schema/vega/v5.json",
	"description": "A basic line chart example.",
	"width": 500,
	"height": 200,
	"padding": 5,

	"signals": [],

	"data": [
		{
			"name": "table",
			"values": [
				{ "x": 0, "y": 2000 },
				{ "x": 1, "y": 2010 },
				{ "x": 2, "y": 2040 },
				{ "x": 3, "y": 1970 },
				{ "x": 4, "y": 2040 },
				{ "x": 5, "y": 2020 }
			]
		}
	],

	"scales": [
		{
			"name": "x",
			"type": "point",
			"range": "width",
			"domain": { "data": "table", "field": "x" },
		},
		{
			"name": "y",
			"type": "linear",
			"range": "height",
			"nice": true,
			"zero": false,
			"domain": { "data": "table", "field": "y" }
		}
	],

	"axes": [
		{ "orient": "bottom", "scale": "x", "labels": false },
		{ "orient": "left", "scale": "y" }
	],

	"marks": [
		{
			"type": "group",
			"from": {
				"data": "table"
			},
			"marks": [
				{
					"type": "line",
					"from": { "data": "table" },
					"encode": {
						"enter": {
							"x": { "scale": "x", "field": "x" },
							"y": { "scale": "y", "field": "y" },
							"strokeWidth": { "value": 1 }
						}
					}
				}
			]
		}
	]
};

const graphConfig = {
	"background": "#333",
	"title": { "color": "#fff", "subtitleColor": "#fff" },
	"style": { "guide-label": { "fill": "#fff" }, "guide-title": { "fill": "#fff" } },
	"axis": { "domainColor": "#fff", "gridColor": "#888", "tickColor": "#fff" }
};

const processManager = new AsyncProcessManager<[User], string>(actuallyCreateUserEloGraph);

async function actuallyCreateUserEloGraph(user: User) {
	if (!fs.existsSync(eloGraphOutput)) fs.mkdirSync(eloGraphOutput, { recursive: true });
	// @ts-ignore
	graphSchema.data[0].values = user.eloHistory.map((elo, idx) => ({ x: idx, y: elo.elo }));
	const view = new vega
		.View(vega.parse(graphSchema, graphConfig))
		.renderer("none")
		.initialize();

	const svg = await view.toSVG();
	const outputPath = `${eloGraphOutput}${user.id}.png`;
	await sharp(Buffer.from(svg))
		.resize(null, 500)
		.toFormat("png")
		.toFile(outputPath);

	return path.resolve(outputPath);
}


export async function createUserEloGraph(user: User) {
	return processManager.execute(user.id, user);
}