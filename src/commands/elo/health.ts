import Discord from "discord.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { NoArgs } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { DaemonReport } from "../../api.js";
import { Application } from "../../application.js";

interface PrefixedResult {
	prefix: string;
	result: string;
	suffix: string;
}

interface HealthItem {
	name: string;
	exec: () => Promise<string | PrefixedResult>;
}

interface HealthPendingResult {
	name: string;
	isFinished: boolean;
	result: string | PrefixedResult;
}

const maybeNever = (t: number, elseMsg: string) => (t == 0 ? "Never" : elseMsg);
const deltaTime = (t: number) => maybeNever(t, `${Math.floor((Date.now() - t) / 1000)} seconds ago`);
const deltaTimeMinutes = (t: number) => maybeNever(t, `${Math.floor((Date.now() - t) / 1000 / 60)} minutes ago`);

const error = (msg: string): PrefixedResult => ({ prefix: "[2;31m", suffix: "[0m[0m", result: msg });
const success = (msg: string): PrefixedResult => ({ prefix: "[2;32m", suffix: "[0m[0m", result: msg });

/*
```ansi
Hello world!

[2;31mError text

[2;32mSuccess Text

[2;30m[2;37mHello world![0m[2;30m[0m[2;32m[0m[2;31m
[0m
```
*/

class Health extends SlashCommand {
	name = "health";
	description = "Runs various health checks on the server";

	@NoArgs
	async run({ interaction, framework, app }: SlashCommandEvent<Application>) {
		const daemonReportCbs: ((report: DaemonReport) => void)[] = [];
		const drv = async <T extends keyof DaemonReport>(key: T): Promise<DaemonReport[T]> => {
			const report = await new Promise<DaemonReport>(res => daemonReportCbs.push(res));
			return report[key];
		};

		const healthItems: HealthItem[] = [
			{ name: "Last Online User Update", exec: async () => deltaTime(app.lastOnlineUserUpdateAt) },
			{ name: "Online Users", exec: async () => app.onlineUsers.length.toString() },
			{ name: "Connected WS clients", exec: async () => app.api.clients.length.toString() },
			{ name: "HS -> Elo Connection", exec: async () => (app.api.clients.some(u => u.isAuthedHs) ? success("Client found") : error("No client")) },
			{ name: "Daemon -> Elo Connection", exec: async () => (app.api.clients.some(u => u.isAuthedDaemon) ? success("Client found") : error("No client")) },
			{ name: "Seen SM Leave", exec: async () => ((await drv("seenSmLeaveMessage")) ? error("SM Leave (Steam failure)") : success("No")) },
			{ name: "Lobby creation failed", exec: async () => ((await drv("seenLobbyCreationFailedMessage")) ? error("Lobby creation failed") : success("No")) },
			{ name: "Last high tick rate", exec: async () => deltaTime(await drv("lastHighAverageTick")) },
			{ name: "Exception", exec: async () => ((await drv("exceptionSeen")) ? error("Exception seen") : success("No")) },
			{ name: "Last restart", exec: async () => deltaTime(await drv("lastRestart")) },
			{ name: "Last user join attempt", exec: async () => deltaTime(await drv("lastUserJoinAttempt")) },
			{ name: "Last user join success", exec: async () => deltaTime(await drv("lastUserJoinSuccess")) },
			{ name: "Last server start", exec: async () => deltaTimeMinutes(await drv("lastCommandedServerStart")) },
			{ name: "Last server stop", exec: async () => deltaTimeMinutes(await drv("lastServerStop")) }
		];

		const embed = new Discord.EmbedBuilder();
		embed.setTitle("Health Check");
		embed.setTimestamp();
		// const msg = await message.channel.send({ embeds: [embed] });
		await interaction.reply({ embeds: [embed] });

		const execProms = healthItems.map((item): HealthPendingResult => {
			const prom = item.exec();

			const resultObject: HealthPendingResult = {
				name: item.name,
				isFinished: false,
				result: "Pending..."
			};

			prom.then(result => {
				resultObject.result = result;
				resultObject.isFinished = true;
				updateDesc();
			});

			return resultObject;
		});

		let updateTimeout: NodeJS.Timeout;
		const updateDesc = () => {
			if (updateTimeout) clearTimeout(updateTimeout);
			updateTimeout = setTimeout(update, 100);
		};

		const update = () => {
			let description = `\`\`\`ansi\n`;
			for (const item of execProms) {
				let line = ``;
				if (typeof item.result == "object") {
					line = `${item.result.prefix}${item.name}: ${item.result.result}${item.result.suffix}`;
				} else {
					line = `${item.name}: ${item.result}`;
				}

				description += `${line}\n`;
			}

			description += `\`\`\``;
			embed.setDescription(description);

			// msg.edit({ embeds: [embed] });
			interaction.editReply({ embeds: [embed] });
		};

		app.api.daemonReportCb = report => daemonReportCbs.forEach(cb => cb(report));
		app.api.sendDaemonReportRequest();
	}
}

export default Health;
