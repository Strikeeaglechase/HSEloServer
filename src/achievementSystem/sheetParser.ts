import fs from "fs";
import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import FrameworkClient from "strike-discord-framework";
import Logger from "strike-discord-framework/dist/logger.js";

import { Achievement, AchievementDef } from "./achievement.js";
import { AchievementManager } from "./achievementManager.js";

class GoogleSheetParser {
	private doc: GoogleSpreadsheet;
	private log: Logger;
	constructor(private sheetId: string, private manager: AchievementManager) {
		this.log = manager.log;
	}

	private loadCreds() {
		const creds = JSON.parse(fs.readFileSync("../caw8-creds.json", "utf8"));

		const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"];

		const jwt = new JWT({
			email: creds.client_email,
			key: creds.private_key,
			scopes: SCOPES
		});

		return jwt;
	}

	async init() {
		const jwt = this.loadCreds();
		this.doc = new GoogleSpreadsheet(this.sheetId, jwt);
		await this.doc.loadInfo(); // loads document properties and worksheets
		this.log.info(`Loaded document: ${this.doc.title}`);
	}

	async parseAchievements(): Promise<Achievement[]> {
		const achievementSheet = this.doc.sheetsByIndex[0];
		await achievementSheet.loadCells();

		const achievements: Achievement[] = [];
		for (let row = 1; row < achievementSheet.rowCount; row++) {
			if (achievementSheet.getCell(row, 0).value == null) break;
			const data: AchievementDef = {
				id: achievementSheet.getCell(row, 0).value as AchievementDef["id"],
				name: achievementSheet.getCell(row, 1).value as AchievementDef["name"],
				description: achievementSheet.getCell(row, 2).value as AchievementDef["description"],
				condition: achievementSheet.getCell(row, 3).value as AchievementDef["condition"],
				max: achievementSheet.getCell(row, 4).value as AchievementDef["max"],
				enabled: achievementSheet.getCell(row, 5).value as AchievementDef["enabled"]
			};

			achievements.push(await Achievement.create(data, this.manager));
		}

		return achievements;
	}
}

export { GoogleSheetParser };
