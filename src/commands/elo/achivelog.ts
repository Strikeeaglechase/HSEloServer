import { PermissionFlagsBits, TextChannel } from "discord.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

class AchieveLog extends Command {
	name = "achievelog";
	allowDm = false;
	help = {
		msg: "Creates the achievement log channel, max 1 per server, must be an admin to run this command",
		usage: ""
	};

	async run({ message, framework, app }: CommandEvent<Application>) {
		if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return framework.error(`You must be an admin to run this command`);
		}

		const existing = await app.achievementLogChannels.collection.findOne({ guildId: message.guild.id });

		if (existing) {
			const confirm = await framework.utils.reactConfirm(`There is already a onlineboard in this server, do you want to delete it?`, message);
			if (confirm) {
				await app.deleteAchievementLogChannel(existing);
			}
		}

		await app.createAchievementLogChannel(message.channel as TextChannel);

		const msg = await message.channel.send(framework.success(`Set this channel for achievement logs!`));
		await new Promise(resolve => setTimeout(resolve, 5000));
		await msg.delete().catch(() => {});
		await message.delete().catch(() => {});
	}
}

export default AchieveLog;
