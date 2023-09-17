import vega from "vega";

export const normGraph: vega.Spec = {
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
				{ x: 0, y: 2000 },
				{ x: 1, y: 2010 },
				{ x: 2, y: 2040 },
				{ x: 3, y: 1970 },
				{ x: 4, y: 2040 },
				{ x: 5, y: 2020 }
			]
		}
	],

	scales: [
		{
			name: "x",
			type: "point",
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
				data: "table"
			},
			marks: [
				{
					type: "line",
					from: { data: "table" },
					encode: {
						enter: {
							x: { scale: "x", field: "x" },
							y: { scale: "y", field: "y" },
							strokeWidth: { value: 1 }
						}
					}
				}
			]
		}
	]
};
