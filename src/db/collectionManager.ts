import { Collection, FilterQuery } from "mongodb";

// This file defines a manager wrapper around mongoDB "Collections", they allow custom ID type/prop names
import Database from "./database.js";

interface Encoder<DataType, SerializedData> {
	toDb: (obj: DataType) => SerializedData;
	fromDb: (obj: SerializedData) => DataType;
}

class CollectionManager<T, IDType extends string = string> {
	database: Database;
	collection: Collection<T>;
	// All values deleted are archived just in case
	archive: Collection<T>;
	useCache: boolean;
	collectionName: string;
	cache: T[];
	idProp: string;
	// "idProp" is the name of the property on the object used as its uid, by default mongoDB uses _id with "ObjectID" type, but it can be anthing here
	constructor(database: Database, collectionName: string, cache: boolean, idProp: string) {
		this.useCache = cache;
		this.database = database;
		this.collectionName = collectionName;
		this.idProp = idProp;
	}
	// Creates the collections and fills the cache if its being used
	async init() {
		this.collection = this.database.db.collection<T>(this.collectionName);
		this.archive = this.database.db.collection<T>(this.collectionName + "Archive");
		if (this.useCache) await this.updateCache();
	}
	// WARN: This function returns {idProp: id} (example: {_id: "abc"})
	// however the return type is very different to work with MongoDB
	getLookup(id: IDType) {
		// Using a record here feels a bit weird as its only one prop, but gets the job done
		const obj: Record<string, IDType> = {};
		obj[this.idProp] = id;
		return obj as FilterQuery<T>;
	}
	// Fills the cache
	async updateCache() {
		this.cache = await this.get();
	}
	// Syncronusly returns cached values
	getCached(): T[] {
		return this.cache;
	}
	// Either returns all items, or one item by ID from the collection
	async get(): Promise<T[]>;
	async get(id: IDType): Promise<T>;
	async get(id?: IDType): Promise<T | T[]> {
		if (!id) {
			return (await this.collection.find({}).toArray()) as T[];
		}
		return (await this.collection.findOne(this.getLookup(id))) as T;
	}
	// Inserts an item into the collection
	async add(obj: T) {
		const res = await this.collection.insertOne(obj as any);
		if (this.useCache) await this.updateCache();
		return res;
	}
	// Updates an item in the collection (adds the item if it dosnt exist)
	async update(obj: T, id: IDType) {
		const res = await this.collection.updateOne(this.getLookup(id), { $set: obj }, { upsert: true });
		if (this.useCache) await this.updateCache();
		return res;
	}
	// Removes an item from the collection and moves it to the cache
	async remove(id: IDType) {
		const item = await this.get(id);
		if (!item) return;
		await this.archive.insertOne(item as any);
		const res = await this.collection.deleteOne(this.getLookup(id));
		if (this.useCache) await this.updateCache();
		return res;
	}
}

export { CollectionManager, Encoder };
