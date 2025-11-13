import { SlashCommand, SlashCommandEvent } from "strike-discord-framework";
import { SArg } from "strike-discord-framework/dist/slashCommandArgumentParser.js";
import { Application } from "../../application.js";

export enum EvasionConditionType {
    GPull = "gpull",
    Notching = "notching",
    TerrainMask = "terrain mask",
    Cranking = "cranking",
    Intercept = "intercept"
}

export const evasionConditions = [
    { name: "G-Pull", value: EvasionConditionType.GPull },
    { name: "Notching", value: EvasionConditionType.Notching },
    { name: "Terrain Mask", value: EvasionConditionType.TerrainMask },
    { name: "Cranking", value: EvasionConditionType.Cranking },
    { name: "Intercept", value: EvasionConditionType.Intercept }
];

class Evasion extends SlashCommand {
    async run(
        { interaction }: SlashCommandEvent<Application>,
        @SArg({ required: true, choices: evasionConditions }) condition: EvasionConditionType
    ) {
        let response = "";
        switch (condition) {
            case EvasionConditionType.GPull:
                response = "G-Pull: Pulling high Gs to defeat incoming missiles.";
                break;
            case EvasionConditionType.Notching:
                response = "Notching: Flying perpendicular to radar to break missile lock.";
                break;
            case EvasionConditionType.TerrainMask:
                response = "Terrain Mask: Using terrain to block enemy radar/missiles.";
                break;
            case EvasionConditionType.Cranking:
                response = "Cranking: Turning away to reduce closure rate while maintaining radar lock.";
                break;
            case EvasionConditionType.Intercept:
                response = "Intercept: Maneuvering to meet and engage the target efficiently.";
                break;
            default:
                response = "Unknown evasion condition.";
        }
        await interaction.editReply(response);
    }
}

export default Evasion;
