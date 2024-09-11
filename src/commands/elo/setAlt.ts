import { Application } from "../../application.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { replyOrEdit } from "../../iterConfirm.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";


const nums = "0123456789";

class SetAlt extends SlashCommand {
	name = "setalt";
	description = "Set a steamID as an alt account";

	async run({ interaction, framework, app }: SlashCommandEvent<Application>, @SArg() steamId: string) {
		// Check steamid is numeric
		const isNumeric = steamId.split("").every(c => nums.includes(c));
		if (!isNumeric) {
			interaction.reply(framework.error(`Please provide your alt's steamID64 (https://steamid.io/lookup/${steamId})`));
			return;
		}
        // Check existing
		const existing = await app.users.collection.findOne({ discordId: interaction.user.id });
		if (!existing) {
			replyOrEdit(interaction, framework.error('You are not linked to any account'));
			return;
		}

        // Check steamid exists
		const user = await app.users.get(steamId);
		if (!user) {
			replyOrEdit(interaction, framework.error(`That steamID does not exist (connect to the server at least once)`));
			return;
		}

        //check that the alt is not linked to any discord account
        if (user.discordId) { 
            replyOrEdit(interaction, framework.error(`That steamID is already linked to a discord account`));
            return;
        }
        
        //check that the alt is not already an alt account
        if (user.isAlt) {
            replyOrEdit(interaction, framework.error(`That steamID is already an alt account`));
            return;
        }

        
        await app.users.collection.updateOne({id: user.id}, {$set: {isAlt: true, altParentId: existing.id} });
        await app.users.collection.updateOne({id: existing.id}, {$push: {altIds: user.id} });

        replyOrEdit(interaction, framework.success(`You have successfully linked ${user.pilotNames[0]} (${user.id}) as an alt account`));

	}
}

export default SetAlt;