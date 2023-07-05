import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { API } from "./api.js";
import { Application } from "./application.js";

interface Packet {
	type: string;
	pid?: string;
	data?: any;
}

const validLookupChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

class Client {
	public alive = true;
	public isAuthenticated = false;
	public id: string;

	private api: API;
	private lastPingReply = Date.now();

	constructor(private app: Application, private socket: WebSocket) {
		this.id = uuidv4();
		this.api = app.api;

		setInterval(() => this.ping(), 1000 * 5);

		socket.on("message", (data) => {
			try {
				const packet = JSON.parse(data.toString()) as Packet;
				this.onMessage(packet);
			} catch (e) {
				this.app.log.error(e);
				this.app.log.error(`error while parsing message from client ${this.id}`);
				this.app.log.error(data);
			}
		});

		socket.on("close", () => {
			this.alive = false;
		});
	}

	private onMessage<T extends Packet>(message: T) {
		switch (message.type) {
			case "pong": this.lastPingReply = Date.now(); break;
			case "lookup": this.handleLookup(message); break;

			case "authenticate": {
				const valid = message.data.token == process.env.AUTH_TOKEN;
				if (valid) {
					this.isAuthenticated = true;
					this.app.log.info(`client ${this.id} authenticated`);
				} else {
					this.app.log.warn(`client ${this.id} failed to authenticate. They sent token: ${message.data.token}`);
					this.socket.close();
				}
				break;
			}

			default:
				this.handleAuthenticatedMessage(message);
				break;
		}
	}

	private handleLookup<T extends Packet>(packet: T) {
		const category: string = packet?.data?.category;
		let id: string = packet?.data?.id;
		if (!category || !id) return;
		id = id.split("").filter(c => validLookupChars.includes(c)).join("");
		switch (category) {
			case "kill": this.app.kills.get(id).then(r => this.replyToLookup(packet, r)); break;
			case "death": this.app.deaths.get(id).then(r => this.replyToLookup(packet, r)); break;
			case "user": this.app.users.get(id).then(r => this.replyToLookup(packet, r)); break;
			case "user_by_name": this.app.users.collection.findOne({ pilotNames: { $regex: id } }).then(r => this.replyToLookup(packet, r)); break;
			case "kills_by_killer": this.app.kills.collection.find({ "killer.ownerId": id }).limit(2000).toArray().then(r => this.replyToLookup(packet, r)); break;
			case "kills_by_victim": this.app.kills.collection.find({ "victim.ownerId": id }).limit(2000).toArray().then(r => this.replyToLookup(packet, r)); break;
		}
	}

	private replyToLookup<T extends Packet>(packet: T, data: unknown) {
		this.send({ type: "response", orgPid: packet.pid, orgType: packet.type, result: data });
	}

	private handleAuthenticatedMessage<T extends Packet>(packet: T) {
		if (!this.isAuthenticated) return;

		// Retransmit packet to all clients
		this.app.api.clients.forEach((client) => {
			if (client.id == this.id) return;
			client.send(packet);
		});

		switch (packet.type) {
			case "user_login": this.exec(this.api.handleUserLogin(packet.data.userId, packet.data.pilotName), packet); break;
			case "user_logout": this.exec(this.api.handleUserLogout(packet.data.userId), packet); break;
			case "kill": this.exec(this.api.handleKill(packet.data), packet); break;
			case "death": this.exec(this.api.handleDeath(packet.data), packet); break;
			case "spawn": this.exec(this.api.handleSpawn(packet.data), packet); break;
			case "tracking": this.exec(this.api.handleTracking(packet.data.trackingType, packet.data.trackingData), packet); break;
			case "online": this.exec(this.api.updateOnlineUsers(packet.data), packet); break;

			default:
				this.app.log.warn(`client ${this.id} sent unknown packet type: ${packet.type}`);
				break;
		}
	}

	private async exec(result: Promise<any>, packet: Packet) {
		const resultValue = await result;
		this.send({ type: "response", orgPid: packet.pid, orgType: packet.type, result: resultValue });
	}

	private ping() {
		if (!this.alive) return;
		if (Date.now() - this.lastPingReply > 1000 * 30) {
			this.alive = false;
			this.socket.close();
			return;
		}

		this.send({ type: "ping" });
	}

	public send<T extends Packet>(data: T) {
		if (!this.alive) return;
		const result = { pid: uuidv4(), ...data };
		this.socket.send(JSON.stringify(result));
	}
}

export { Client };