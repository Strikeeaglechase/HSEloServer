import { SlashCommand, SlashCommandAutocompleteEvent, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";

import { admins, Application } from "../../application.js";

const validateFloat = (value: string) => {
	if (isNaN(parseFloat(value))) return false;
	return true;
};

class ServerCommand extends SlashCommand {
	name = "command";
	description = "Executes a server command";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg({ autocomplete: true }) user: string, @SArg({}) command: string) {
		if (!admins.includes(interaction.user.id)) {
			await interaction.reply(framework.error("No"));
			return;
		}

		// const target = app.onlineUsers.find(u => u.id == user);
		// if (!target) {
		// 	interaction.reply(framework.error(`Could not find user "${user}" online`, true));
		// 	return;
		// }

		const usageText = `\`explode\`\n\`canopy\`\n\`fuel <lvl:float>\`\n\`damage <enabled:0|1>\`\n\`wind <x:float> <y:float> <z:float> <var:float> <gusts:float>\``;

		const [commandName, ...args] = command.split(" ");
		console.log({ commandName, args });
		switch (commandName) {
			case "explode":
			case "canopy":
				if (args.length > 0) {
					interaction.reply(framework.error(`Expected 0 arguments, got ${args.length}`, true));
					return;
				}
				break;

			case "fuel":
				if (args.length != 1) {
					interaction.reply(framework.error(`Expected 1 argument, got ${args.length}`, true));
					return;
				}
				if (!validateFloat(args[0])) {
					interaction.reply(framework.error(`Expected float argument, got "${args[0]}"`, true));
					return;
				}
				break;

			case "damage":
				if (args.length != 1) {
					interaction.reply(framework.error(`Expected 1 argument, got ${args.length}`, true));
					return;
				}
				if (args[0] != "0" && args[1] != "1") {
					interaction.reply(framework.error(`Expected either "1" or "0"`, true));
					return;
				}
				break;

			case "wind":
				if (args.length != 5) {
					interaction.reply(framework.error(`Expected 5 arguments. Usage: \`wind x y z variable gusts\``, true));
					return;
				}
				if (!args.every(validateFloat)) {
					interaction.reply(framework.error(`Expected float arguments`, true));
					return;
				}
				break;

			default:
				interaction.reply(framework.error(`Unknown command "${commandName}"\nCommands:\n${usageText}`, true));
				return;
		}

		app.api.sendCommandRequest(user, commandName, args);

		return framework.success(`Target: ${user}\nCommand: \`${command}\``);
	}

	public override handleAutocomplete({ interaction, app }: SlashCommandAutocompleteEvent<Application>) {
		const focusedValue = interaction.options.getFocused(true);
		if (focusedValue.name != "user") return;

		const options = app.onlineUsers.map(user => {
			return {
				name: user.name,
				value: user.id
			};
		});

		interaction.respond(options);
	}
}

export default ServerCommand;
