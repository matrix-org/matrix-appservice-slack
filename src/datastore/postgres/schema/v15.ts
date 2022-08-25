import { IDatabase } from "pg-promise";

import { SchemaRunUserMessage } from "../PgDatastore";

export const runSchema = async(db: IDatabase<unknown>): Promise<{userMessages: SchemaRunUserMessage[]}> => {
    // Disallow multiple puppets for the same team for the same user.
    const cases =(await db.manyOrNone(
        `SELECT matrixuser, name FROM (
            SELECT slackteam, matrixuser FROM puppets
            GROUP BY slackteam, matrixuser HAVING COUNT(*) > 1
        ) entry
        LEFT JOIN teams ON entry.slackteam = teams.id;`)).map((puppet => ({
        matrixId: puppet.matrixuser,
        // It's possible the team name might not exist (rarely), so just hide it.
        teamName: puppet.name ? ` (${puppet.name})` : '',
    })));
    // Delete any cases where this has happened
    await db.none(`
        DELETE FROM puppets otr USING (
            SELECT matrixuser, slackteam FROM puppets GROUP BY slackteam, matrixuser HAVING COUNT(*) > 1
        ) inr WHERE otr.matrixuser = inr.matrixuser AND otr.slackteam = inr.slackteam;
        ALTER TABLE puppets ADD CONSTRAINT puppets_slackteam_matrixuser_unique UNIQUE(slackteam, matrixuser);`);
    return {
        userMessages: cases.map(u => ({
            matrixId: u.matrixId,
            message: `Hello. Your Matrix account was puppeted to two or more Slack accounts from the same team${u.teamName}, which` +
            ` is not valid. As a precaution, the bridge has unlinked all Slack accounts where two or more were present from the same team.` +
            ` You can use the \`whoami\` command to find out if any accounts are still linked. To relink your accounts, simply run \`login\`.
            `
        })),
    };
};
