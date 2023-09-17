import vega from "vega";

export const comparisonGraph: vega.Spec = {
	$schema: "https://vega.github.io/schema/vega/v5.json",
	description: "A basic line chart example.",
	width: 500,
	height: 200,
	padding: 5,

	signals: [],

	data: [
		{
			name: "table",
			values: [
				{ x: 1000001, y: 2000, player: 2 },
				{ x: 1000001, y: 2010, player: 2 },
				{ x: 1000002, y: 2040, player: 2 },
				{ x: 1000003, y: 1970, player: 2 },
				{ x: 1000104, y: 2040, player: 2 },
				{ x: 1000300, y: 2020, player: 2 },
				{ x: 1000001, y: 2030, player: 1 },
				{ x: 1000001, y: 2000, player: 1 },
				{ x: 1000002, y: 2020, player: 1 },
				{ x: 1000003, y: 1990, player: 1 },
				{ x: 1000104, y: 2010, player: 1 },
				{ x: 1000300, y: 2070, player: 1 }
			]
		}
	],

	scales: [
		{
			name: "x",
			type: "time",
			range: "width",
			domain: { data: "table", field: "x" }
		},
		{
			name: "y",
			type: "linear",
			range: "height",
			nice: true,
			zero: false,
			domain: { data: "table", field: "y" }
		},
		{
			name: "color",
			type: "ordinal",
			range: "category",
			domain: { data: "table", field: "player" }
		}
	],

	axes: [
		{ orient: "bottom", scale: "x", labels: false },
		{ orient: "left", scale: "y" }
	],
	marks: [
		{
			type: "group",
			from: {
				facet: {
					name: "series",
					data: "table",
					groupby: "player"
				}
			},
			marks: [
				{
					type: "line",
					from: { data: "series" },
					encode: {
						enter: {
							x: { scale: "x", field: "x" },
							y: { scale: "y", field: "y" },
							strokeWidth: { value: 1 },
							stroke: { scale: "color", field: "player" }
						}
					}
				}
			]
		}
	]
};
