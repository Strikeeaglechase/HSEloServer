import "reflect-metadata";

import { Client, IntentsBitField, Partials } from "discord.js";
import { config as dotenvConfig } from "dotenv";
import FrameworkClient from "strike-discord-framework";
import { FrameworkClientOptions } from "strike-discord-framework/dist/interfaces";

import { Application } from "./application.js";

dotenvConfig();

const f = IntentsBitField.Flags;
const frameworkOptions: FrameworkClientOptions = {
	commandsPath: `${process.cwd()}/commands/`,
	databaseOpts: {
		databaseName: "vtol-server-elo" + (process.env.IS_DEV == "true" ? "-dev" : ""),
		url: process.env.DB_URL
	},
	loggerOpts: {
		filePath: `${process.cwd()}/../logs/`,
		logChannels: {
			INFO: process.env.LOG_CHANNEL,
			ERROR: process.env.ERR_CHANNEL,
			WARN: process.env.ERR_CHANNEL
		},
		logToFile: true
	},
	clientOptions: {
		intents: f.Guilds | f.GuildMembers | f.GuildModeration | f.MessageContent | f.DirectMessages | f.GuildMessages | f.GuildVoiceStates,
		partials: [Partials.Channel, Partials.GuildMember, Partials.Message]
	},
	defaultPrefix: ",",
	name: "VTOL Server Elo",
	token: process.env.TOKEN,
	ownerID: "272143648114606083",
	dmPrefixOnPing: true,
	dmErrorSilently: false,
	permErrorSilently: false,
	slashCommandDevServer: "1015729793733492756"
};

const frameClient = new FrameworkClient(frameworkOptions);
const application = new Application(frameClient);

async function init() {
	await frameClient.init(application);
	await application.init();
	await frameClient.loadBotCommands(`${process.cwd()}/../node_modules/strike-discord-framework/dist/defaultCommands/`);
	await frameClient.permissions.setPublic("command.misc", true);
	await frameClient.permissions.setPublic("command.elo", true);

	process.on("unhandledRejection", error => {
		application.log.error(error);
	});
	process.on("uncaughtException", error => {
		application.log.error(error);
	});
}

async function deleteSlashCommands() {
	const client = new Client({ intents: IntentsBitField.Flags.GuildIntegrations });
	client.login(process.env.TOKEN);
	client.on("ready", async () => {
		const devGuild = await client.guilds.fetch("1015729793733492756");
		await devGuild.commands.set([]).then(() => {
						process.exit();
		});
	});
}

const deregisterCommands = false;

if (deregisterCommands) {
	deleteSlashCommands();
} else {
	init();
}
