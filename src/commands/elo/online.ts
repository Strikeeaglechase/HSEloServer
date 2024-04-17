import Discord from "discord.js";
import { CommandRun } from "strike-discord-framework/dist/argumentParser.js";
import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

class Online extends Command {
	name = "online";
	allowDm = false;
	help = {
		msg: "Checks online user list"
	};

	@CommandRun
	async run({ message, framework, app }: CommandEvent<Application>) {
		const existing = await app.onlineboardMessages.collection.findOne({ guildId: message.guild.id });
		if (existing) return message.reply(`Check https://discord.com/channels/${existing.guildId}/${existing.channelId}/${existing.messageId} dummy!`);

		if (app.onlineUsers.length == 0) return framework.error(`No users online!`);

		const onlineUsers = await Promise.all(app.onlineUsers.map(async user => app.users.get(user.id)));
		const elos: number[] = [];

		// username, elo, team
		const table: string[][] = [["User", "Elo", "Team"]];
		onlineUsers.forEach(user => {
			// table.push(${user.pilotNames[0]} ${user.elo} ${app.onlineUsers.find(u => u.id === user.id).team)};
			const team = app.onlineUsers.find(u => u.id === user.id).team;
			table.push([user.pilotNames[0], user.elo.toString(), team]);
			elos.push(user.elo);
		});

		// Calculate min, max, and average elo
		const minElo = Math.round(Math.min(...elos));
		const maxElo = Math.round(Math.max(...elos));
		const avgElo = Math.round(elos.reduce((a, b) => a + b, 0) / elos.length);

		const content = app.table(table).join("\n");
		const timestamp = `<t:${Math.round(Date.now() / 1000)}:R>`;

		const embed = new Discord.EmbedBuilder()
			.setTitle("Online Users")
			.setDescription(`${timestamp}\n\`\`\`\n${content}\n\`\`\``)
			.setFooter({ text: `Min: ${minElo} | Max: ${maxElo} | Avg: ${avgElo}` });
		// .setFooter(`Min: ${minElo} | Max: ${maxElo} | Avg: ${avgElo}`);

		return embed;
	}
}

export default Online;
