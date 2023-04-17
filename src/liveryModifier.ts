import { spawn } from "child_process";
import { config } from "dotenv";
import fs from "fs";
import Jimp from "jimp";
import path from "path";

config();
const VTOL_ID = "667970";
const outputPath = "../liv-mod-output";
if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath);

const decode = (byte: string) => String.fromCharCode((byte.charCodeAt(0) - 88) % 256);
const encode = (byte: string) => String.fromCharCode((byte.charCodeAt(0) + 88) % 256);

interface Livery {
	id: string;
	filePath: string;
	vtl: string;
	texture: string;
	vtlFileName: string;
}

const vdf = `
"workshopitem"
{
 "appid" "${VTOL_ID}"
 %PUBID%
 "contentfolder" "%PATH%"
 "previewfile" "%PATH%/thumb.png"
 "visibility" "3"
 "title" "HS Custom Kill Markers for %USER%"
 "description" "Original livery: %ORG% with %KILLS% kill markers on it"
 "changenote" "Update"
}
`;
// "publishedfileid" "2953736015"

const basePath = path.join(process.cwd(), "..");
const NUM_ICONS = 15 * 3;

function colors(image: Jimp, index: number) {
	const r = image.bitmap.data[index + 0];
	const g = image.bitmap.data[index + 1];
	const b = image.bitmap.data[index + 2];
	const a = image.bitmap.data[index + 3];

	return { r, g, b, a };
}

async function getFromSteam(id: string) {
	const command = [
		"+force_install_dir", basePath,
		"+login", process.env.STEAM_USER, process.env.STEAM_PASS,
		// "+workshop_status", VTOL_ID,
		"+workshop_download_item", VTOL_ID, id,
		"+quit"
	];

	await execSteamCommand(command);
}

function execSteamCommand(command: string[]) {
	const baseCmd = process.platform == "win32" ? "steamcmd" : "/usr/games/steamcmd";
	const steam = spawn(baseCmd, command, { stdio: ["pipe", "pipe", "pipe"] });

	return new Promise<void>((res) => {
		steam.stderr.on("data", data => {
			console.error(`SteamCMD ERROR: ${data.toString()}`);
		});

		steam.on("close", code => {
			console.info(`SteamCMD closed with code ${code}`);
			res();
		});

		steam.on("error", err => {
			console.error(`SteamCMD error: ${err}`);
		});

		steam.stdout.on("data", data => {
			console.log("SteamCMD: " + data.toString());
		});
	});
}

async function download(id: string, ignoreCache = false): Promise<Livery> {
	console.log(`Downloading livery ${id}`);
	const liveryPath = `${basePath}/steamapps/workshop/content/${VTOL_ID}/${id}`;

	let doDownload = true;
	if (!ignoreCache && fs.existsSync(liveryPath)) {
		const files = fs.readdirSync(liveryPath);
		const file = files.find(f => f.endsWith(".vtlb"));
		const info = fs.statSync(`${liveryPath}/${file}`);
		if (Date.now() - info.mtime.getTime() < 1000 * 60 * 5) { // 5 minutes
			doDownload = false;
		}
	}

	// console.log(`About to download: ${doDownload}`);
	if (doDownload) await getFromSteam(id);
	// console.log("Downloaded");


	const files = fs.readdirSync(liveryPath);
	const file = files.find(f => f.endsWith(".vtlb"));
	const vtlFileContent = fs.readFileSync(`${liveryPath}/${file}`, "binary");
	const vtlDecoded = vtlFileContent.split("").map(c => decode(c)).join("");

	const textureContent = fs.readFileSync(`${liveryPath}/texture.pngb`, "binary");
	const textureDecoded = textureContent.split("").map(c => decode(c)).join("");

	return {
		id,
		filePath: liveryPath,
		vtlFileName: file,
		vtl: vtlDecoded,
		texture: textureDecoded
	};
}

async function parseUvMap(aircraft: string) {
	console.log(`Parsing UV map for ${aircraft}`);
	const toMap = [`../uvs/${aircraft}-base.png`];
	if (fs.existsSync(`../uvs/${aircraft}-star.png`)) toMap.push(`../uvs/${aircraft}-star.png`);

	const proms = toMap.map(async fileToMap => {
		const [name, ext] = fileToMap.split("/").pop().split(".");
		if (fs.existsSync(`../uvs/${name}-parsed.png`)) {
			console.log(`UV map for ${fileToMap} already parsed`);
			return;
		}

		const image = await Jimp.read(fileToMap);
		image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
			const { r, g, b } = colors(image, idx);
			const darkness = (r + g + b) / 3;

			if (darkness != 0) {
				image.bitmap.data[idx + 3] = 255;
			} else {
				image.bitmap.data[idx + 3] = 0;
			}
		});


		image.write(`../uvs/${name}-parsed.png`);
		console.log(`Wrote ${name}-parsed.png`);
	});

	await Promise.all(proms);
	console.log("Done parsing UV map");
}

interface Color {
	r: number;
	g: number;
	b: number;
}

const imageWorths = {
	"base": 1,
	"star": 10
};

async function filterAircraftNumber(aircraft: string, width: number, height: number, kills: number, primaryColor: Color, secondaryColor: Color): Promise<Jimp> {
	console.log(`Creating icon overlay for ${aircraft} (${width}x${height}) with ${kills} kills`);
	// Load images
	let images: { image: Jimp, worth: number; numNeeded: number; }[] = [];
	const proms = Object.keys(imageWorths).map(async key => {
		if (fs.existsSync(`../uvs/${aircraft}-${key}-parsed.png`)) {
			const image = await Jimp.read(`../uvs/${aircraft}-${key}-parsed.png`);
			images.push({ image, worth: imageWorths[key], numNeeded: 0 });
			console.log(`Loaded ${aircraft}-${key}-parsed.png`);
		}
	});
	await Promise.all(proms);

	images = images.sort((a, b) => b.worth - a.worth);
	let start = 0;
	let remainingKills = kills;
	images.forEach((image, idx) => {
		const nextWorth = images[idx + 1] ? images[idx + 1].worth : 0;
		let num = 0;
		while (remainingKills - num * image.worth > nextWorth * NUM_ICONS) num++;
		image.numNeeded = num;
		remainingKills -= image.numNeeded * image.worth;

		console.log(`Printing on ${image.numNeeded} ${image.worth}x icons`);

		const texture = image.image;
		texture.scan(0, 0, texture.bitmap.width, texture.bitmap.height, (x, y, idx) => {
			if (image.numNeeded == 0) {
				texture.bitmap.data[idx + 3] = 0;
				return;
			}
			const { r, a } = colors(texture, idx);
			if (a != 0) {
				const color = r;
				const secondaryColorIdx = r - NUM_ICONS - 1;
				if (color >= start && color <= image.numNeeded) {
					texture.bitmap.data[idx + 0] = primaryColor.r;
					texture.bitmap.data[idx + 1] = primaryColor.g;
					texture.bitmap.data[idx + 2] = primaryColor.b;
					texture.bitmap.data[idx + 3] = 255;
				} else if (secondaryColorIdx >= start && secondaryColorIdx <= image.numNeeded) {
					texture.bitmap.data[idx + 0] = secondaryColor.r;
					texture.bitmap.data[idx + 1] = secondaryColor.g;
					texture.bitmap.data[idx + 2] = secondaryColor.b;
					texture.bitmap.data[idx + 3] = 255;
				} else {
					texture.bitmap.data[idx + 3] = 0;
				}
			}
		});

		start = image.numNeeded + 1;

	});


	console.log("Finalizing image");
	const finalImage = new Jimp(images[0].image.bitmap.width, images[0].image.bitmap.height);
	images.forEach(image => {
		finalImage.blit(image.image, 0, 0);
	});

	finalImage.resize(width, height);
	console.log("Done creating icon overlay");
	return finalImage;
}


async function modify(user: string, userId: string, id: string, aircraft: string, kills: number) {
	await parseUvMap(aircraft);
	const livery = await download(id);

	console.log("Got livery");
	const liveryImage = await Jimp.read(Buffer.from(livery.texture, "binary"));
	const uvImage = await filterAircraftNumber(aircraft, liveryImage.bitmap.width, liveryImage.bitmap.height, kills, { r: 0, g: 0, b: 0 }, { r: 255, g: 0, b: 0 });
	liveryImage.blit(uvImage, 0, 0);

	const resultPath = `${outputPath}/${userId}`;
	if (!fs.existsSync(resultPath)) fs.mkdirSync(resultPath);

	await liveryImage.writeAsync(`${resultPath}/texture.png`);
	const fileData = fs.readFileSync(`${resultPath}/texture.png`, "binary");
	fs.writeFileSync(`${resultPath}/texture.pngb`, fileData.split("").map(c => encode(c)).join(""), "binary");
	const toCopy = [
		"WorkshopItemInfo.xml",
		"image.jpg",
		"thumb.png",
		livery.vtlFileName
	];

	toCopy.forEach(file => {
		fs.copyFileSync(livery.filePath + "/" + file, `${resultPath}/${file}`);
		console.log(`Copied ${file} to ${resultPath}/${file}`);
	});

	return await upload(user, userId, id, kills);
}

async function upload(user: string, userId: string, itemId: string, kills: number) {
	console.log("Building workshop.vdf");
	const itemPath = path.resolve(`${outputPath}/${userId}`);
	const vdfPath = `${itemPath}/workshop.vdf`;

	let pubId = "";
	if (fs.existsSync(vdfPath)) {
		const existingVdf = fs.readFileSync(vdfPath, "utf8");
		const existingId = existingVdf.match(/"publishedfileid"\s+"(\d+)"/)[1];
		if (existingId) pubId = `"publishedfileid" "${existingId}"`;
	}

	let fileVdf = vdf
		.replace(/%PATH%/g, itemPath)
		.replace(/%USER%/g, user)
		.replace(/%ORG%/g, `https://steamcommunity.com/sharedfiles/filedetails/?id=${itemId}`)
		.replace(/%KILLS%/g, kills.toString())
		.replace(/%PUBID%/g, pubId);

	fs.writeFileSync(vdfPath, fileVdf.trim());


	const command = [
		"+force_install_dir", basePath,
		"+login", process.env.STEAM_USER, process.env.STEAM_PASS,
		// "+workshop_status", VTOL_ID,
		"+workshop_build_item", vdfPath,
		"+quit"
	];

	console.log("Uploading to Steam");
	await execSteamCommand(command);

	console.log("Done! Livery has been modified and uploaded to Steam");
	const updatedVdf = fs.readFileSync(vdfPath, "utf8");
	const id = updatedVdf.match(/"publishedfileid"\s+"(\d+)"/)[1];
	return id;
}


function parseAircraft(name: string) {
	switch (name) {
		case "FA26b":
		case "FA-26B":
		case "Aircraft/FA-26B":
			return "26b";

		case "F45A":
		case "SEVTF":
		case "Aircraft/SEVTF":
			return "45";

		case "T55":
		case "T-55":
		case "Aircraft/T-55":
			return "t55";

		default:
			throw new Error(`Unknown aircraft: ${name}`);
	}
}

async function run() {
	const [user, userId, workshopId, aircraft, kills] = process.argv;
	const id = await modify(user, userId, workshopId, parseAircraft(aircraft), parseInt(kills));
	console.log(`RESULT: ${id}`);
}


run();
