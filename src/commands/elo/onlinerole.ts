import Discord from "discord.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";
import { Arg } from 'strike-discord-framework/dist/argumentParser.js';

class Onlinerole extends Command {
	name = "onlinerole";
	altNames = [];
	allowDm = false;
	help = {
		msg: "Set the role to be given to online users, max 1 per server, must be an admin to run this command",
		usage: "",
	};

	async run({ message, framework, app }: CommandEvent<Application>, @Arg() role: Discord.Role) {
		if (!message.member.permissions.has("ADMINISTRATOR")) {
			return framework.error(`You must be an admin to run this command`);
		}

		const existing = await app.onlineRoles.collection.findOne({ guildId: message.guild.id });

		if (existing) {
			const confirm = await framework.utils.reactConfirm(`There is already a onlinerole in this server, do you want to delete it?`, message);
			if (confirm) {
				await app.deleteOnlineRole(existing);
			}
		}

		const same = await app.onlineRoles.collection.findOne({ roleId: role.id });

		if (same) {
			return framework.error(`This role is already set to be given to online users`);
		}

		const onlinerole = await app.createOnlinerole(role);
		if (!onlinerole) return framework.error(`An error has occurred while creating the onlinerole`);
		const msg = await message.channel.send(framework.success(`Onlinerole created!`));
		await new Promise((resolve) => setTimeout(resolve, 5000));
		await msg.delete().catch(() => { });
		await message.delete().catch(() => { });
	}
}

export default Onlinerole;