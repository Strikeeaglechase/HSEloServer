import { CollectionManager } from "../../db/collectionManager.js";
import { AchievementDBEntry, Aircraft, EndOfSeasonStats, Season, User } from "../../structures.js";
import { BASE_ELO, userCanRank } from "../eloUpdater.js";
import { ProdDBBackUpdater } from "./eloUtils.js";

const targetSeason = 4;

class EndOfSeasonStatsUpdater extends ProdDBBackUpdater {
	private endOfSeasonStats: CollectionManager<EndOfSeasonStats>;
	private achievementsDb: CollectionManager<AchievementDBEntry>;

	public override async loadDb() {
		await super.loadDb();
		this.endOfSeasonStats = await this.db.collection("end-of-season-stats", false, "id");
		this.achievementsDb = await this.db.collection("achievements", false, "id");
	}

	// Need to patch method as typical query only pulls for users who have done "something" this season
	protected override async loadUsers() {
		const usersMap: Record<string, User> = {};
		let users: User[] = [];

		users = await this.userDb.collection.find().toArray();

		users.forEach(u => {
			this.oldUsers[u.id] = JSON.parse(JSON.stringify(u));
			u.elo = BASE_ELO;
			u.kills = 0;
			u.deaths = 0;
			u.eloHistory = [];
			u.history = [];
			usersMap[u.id] = u;
		});

		this.users = users;
		this.usersMap = usersMap;

		console.log(`Loaded ${users.length} users.`);
	}

	protected override async getActiveSeason() {
		const season = await this.seasons.collection.findOne({ id: targetSeason });
		return season;
	}

	public async storeSeasonStats() {
		const userStats: EndOfSeasonStats[] = this.users
			.filter(u => u.elo != BASE_ELO)
			.map(u => {
				return {
					id: `${u.id}-${targetSeason}`,
					season: targetSeason,
					userId: u.id,
					elo: u.elo,
					kills: u.kills,
					deaths: u.deaths,
					rank: u.rank,
					history: u.history.join("\n"),
					achievements: u.achievements,
					teamKills: u.teamKills
				};
			});

		console.log(`Loaded stats for ${userStats.length} users (of a possible ${this.users.length}).`);
		// Drop existing stats
		const dropResult = await this.endOfSeasonStats.collection.deleteMany({ season: targetSeason });
		console.log(`Deleted ${dropResult.deletedCount} existing stats.`);
		// Insert new stats
		await this.endOfSeasonStats.collection.insertMany(userStats);
		console.log(`All new stats inserted.`);

		if (this.season.active) {
			const achievementHistory = await this.achievementsDb.collection.find().toArray();
			console.log(`Is active season, storing achievement history for ${achievementHistory.length} achievements.`);
			await this.seasons.collection.updateOne({ id: targetSeason }, { $set: { "endStats.achievementHistory": achievementHistory } });
		}

		const totalRankedUsers = this.users.filter(u => userCanRank(u)).length;
		console.log(`Setting total ranked users to ${totalRankedUsers}.`);
		await this.seasons.collection.updateOne({ id: targetSeason }, { $set: { totalRankedUsers: totalRankedUsers } });

		console.log(`All stats for season ${targetSeason} finalized.`);
	}

	public async createSeason(seasonId: number, name: string) {
		const season: Season = {
			id: seasonId,
			started: new Date().toISOString(),
			ended: null,
			active: false,
			name: name,
			totalRankedUsers: 0,
			endStats: {
				achievementHistory: []
			}
		};

		this.seasons.add(season);
	}

	public async clearAllUserStats() {
		console.log(`Clearing all user stats...`);
		const users = await this.userDb.get();

		const proms = users.map(async user => {
			const oldObj = JSON.stringify(user);
			user.kills = 0;
			user.deaths = 0;
			user.spawns = {
				[Aircraft.AV42c]: 0,
				[Aircraft.FA26b]: 0,
				[Aircraft.F45A]: 0,
				[Aircraft.AH94]: 0,
				[Aircraft.Invalid]: 0,
				[Aircraft.T55]: 0,
				[Aircraft.EF24G]: 0
			};
			user.elo = BASE_ELO;
			user.eloHistory = [];
			user.rank = 0;
			user.achievements = [];

			if (!user.isBanned) user.teamKills = 0;

			const newObj = JSON.stringify(user);
			if (oldObj === newObj) return;
			// await this.userDb.update(user, user.id);
			// console.log(user._id);
			await this.userDb.collection.updateOne({ _id: user["_id"] }, { $set: user });
		});
		console.log(`Waiting for ${proms.length} promises to resolve...`);
		await Promise.all(proms);

		console.log(`Done, reset ${users.length} users!`);
	}
}

async function runUpdate() {
	const updater = new EndOfSeasonStatsUpdater();
	// await updater.runBackUpdate();
	// await updater.storeSeasonStats();

	await updater.loadDb();
	// await updater.createSeason(5, "Season 5");
	await updater.clearAllUserStats();
}

runUpdate();
