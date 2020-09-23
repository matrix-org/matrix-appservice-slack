import pgp from "pg-promise";
import { MatrixUser } from "matrix-appservice-bridge";

export const runSchema = async(db: pgp.IDatabase<any>): Promise<void> => {
    // Create database
    await db.none(`
        CREATE TABLE linked_accounts (
            user_id TEXT NOT NULL,
            slack_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            access_token TEXT NOT NULL,
            CONSTRAINT cons_linked_accounts_unique UNIQUE(user_id, slack_id)
        );
    `);
    // Insert entries from users table.
    const users = await db.manyOrNone("SELECT userid, json FROM users WHERE isremote = false;");
    const pgInstance = pgp();
    const cs = new pgInstance.helpers.ColumnSet(['user_id', 'slack_id', 'team_id', 'access_token'], {table: 'linked_accounts'});
    const values: {user_id: string, slack_id: string, team_id: string, access_token: string}[] = [];
    for (const userData of users) {
        const user = new MatrixUser(userData.userid, JSON.parse(userData.json));
        if (!user.get("accounts")) {
            continue;
        }

        for (const [slackId, account] of Object.entries<any>(user.get("accounts") || { })) {
            values.push({
                user_id: userData.userid,
                slack_id: slackId,
                team_id: account.team_id,
                access_token: account.access_token,
            });
        }
    }
    if (values.length) {
        await db.none(pgInstance.helpers.insert(values, cs));
    }
};
