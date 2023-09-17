import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

class Onlineboard extends Command {
	name = "onlineboard";
	altNames = ["onlinelist"];
	allowDm = false;
	help = {
		msg: "Creates the onlineboard listing, max 1 per server, must be an admin to run this command",
		usage: ""
	};

	async run({ message, framework, app }: CommandEvent<Application>) {
		if (!message.member.permissions.has("ADMINISTRATOR")) {
			return framework.error(`You must be an admin to run this command`);
		}

		const existing = await app.onlineboardMessages.collection.findOne({ guildId: message.guild.id });

		if (existing) {
			const confirm = await framework.utils.reactConfirm(`There is already a onlineboard in this server, do you want to delete it?`, message);
			if (confirm) {
				await app.deleteOnlineboard(existing);
			}
		}

		const onlineboard = await app.createOnlineboard(message);
		if (!onlineboard) return framework.error(`An error has occurred while creating the onlineboard`);
		const msg = await message.channel.send(framework.success(`Onlineboard created!`));
		await new Promise(resolve => setTimeout(resolve, 5000));
		await msg.delete().catch(() => {});
		await message.delete().catch(() => {});
	}
}

export default Onlineboard;
