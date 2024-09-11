import { admins, Application } from "../../application.js";
import { SlashCommand, SlashCommandEvent } from "strike-discord-framework/dist/slashCommand.js";
import { replyOrEdit } from "../../iterConfirm.js";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
const nums = "0123456789";

class ForceSetAlt extends SlashCommand {
    name = "forcesetalt";
    description = "forces a alt to be set to a user";

    async run({ interaction, framework, app}: SlashCommandEvent<Application>, @SArg() parentId: string, @SArg() altId: string){

        if (!admins.includes(interaction.user.id)) {
            await interaction.reply(framework.error("No"));
            return;
        }
        // Check steamid for parent is numeric
        const isParentIDNumeric = parentId.split("").every(c => nums.includes(c));
        if (!isParentIDNumeric) {
            interaction.reply(framework.error(`Please provide your parent accounts steamID64 (https://steamid.io/lookup/${parentId})`));
            return;
        }
        // Check steamid for alt is numeric
        const isAltIDNumeric = altId.split("").every(c => nums.includes(c));
        if (!isAltIDNumeric) {
            interaction.reply(framework.error(`Please provide your alt's steamID64 (https://steamid.io/lookup/${altId})`));
            return;
        }

        //check parentSteamId exists
        const parent = await app.users.get(parentId);
        if (!parent) {
            interaction.reply(framework.error(`That steamID does not exist (connect to the server at least once)`));
            return;
        }

        //check altSteamId exists
        const alt = await app.users.get(altId);
        if (!alt) {
            interaction.reply(framework.error(`That steamID does not exist (connect to the server at least once)`));
            return;
        }
        // check that the parent is not an alt account
        if (parent.isAlt) {
            interaction.reply(framework.error(`That steamID is already an alt account`));
            return;
        }
        //check that the alt is not linked to any discord account
        if (alt.discordId) { 
            interaction.reply(framework.error(`The specified alts steamID is already linked to a discord account`));
            return;
        }
        //check that the alt is not already an alt account
        if (alt.isAlt) {
            interaction.reply(framework.error(`The specified alts steamID is already an alt account`));
            return;
        }

        await app.users.collection.updateOne({id: alt.id}, {$set: {isAlt: true, altParentId: parent.id} });
        await app.users.collection.updateOne({id: parent.id}, {$push: {altIds: alt.id} });

        replyOrEdit(interaction, framework.success(`You have successfully linked ${alt.pilotNames[0]} (${alt.id}) as an alt account to ${parent.pilotNames[0]} (${parent.id})`));


    }
}

export default ForceSetAlt;