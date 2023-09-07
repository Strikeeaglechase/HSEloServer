import { Command, CommandEvent } from "strike-discord-framework/dist/command.js";

import { Application } from "../../application.js";

const reqRole = "1149206471146475550";
class Restart extends Command {
	name = "restart";
	allowDM = false;
	help = {
		msg: "Restarts the HS server. Will disconnect any current users"
	};

	async run({ message, framework, app }: CommandEvent<Application>) {
		const userHasRole = message.member.roles.cache.has(reqRole);

		if (!userHasRole) {
			return framework.error("You do not have permission to run this command");
		}

		const confirm = framework.utils.reactConfirm(
			`Are you sure you would like to restart the server? Confirm error state with \`health\` command. This will disconnect any current users`,
			message,
			{
				onConfirm: () => {
					app.api.sendRestartRequest();
					return framework.success("Server is restarting");
				}
			});
	}
}

export default Restart;