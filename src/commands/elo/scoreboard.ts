import { PermissionFlagsBits } from "discord.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

class Scoreboard extends Command {
	name = "scoreboard";
	altNames = ["list"];
	allowDm = false;
	help = {
		msg: "Creates the scoreboard listing, max 1 per server, must be an admin to run this command",
		usage: ""
	};

	async run({ message, framework, app }: CommandEvent<Application>) {
		if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return framework.error(`You must be an admin to run this command`);
		}

		const existing = await app.scoreboardMessages.collection.findOne({ guildId: message.guild.id });

		if (existing) {
			const confirm = await framework.utils.reactConfirm(`There is already a scoreboard in this server, do you want to delete it?`, message);
			if (confirm) {
				await app.deleteScoreboard(existing);
			}
		}

		const scoreboard = await app.createScoreboard(message);
		if (!scoreboard) return framework.error(`An error has occurred while creating the scoreboard`);
		const msg = await message.channel.send(framework.success(`Scoreboard created!`));
		await new Promise(resolve => setTimeout(resolve, 5000));
		await msg.delete().catch(() => {});
		await message.delete().catch(() => {});
	}
}

export default Scoreboard;
