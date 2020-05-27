import { IDatabase } from "pg-promise";
import { MatrixUser } from "matrix-appservice-bridge";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {
    // Create database
    await db.none(`
        CREATE TABLE linked_accounts (
            user_id TEXT NOT NULL,
            slack_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            team_name TEXT NOT NULL,
            access_token TEXT NOT NULL,
            CONSTRAINT cons_linked_accounts_unique UNIQUE(user_id, slack_id)
        );
    `);
    // Insert entries from users table.
    const users = await db.manyOrNone("SELECT userid, json FROM users WHERE isremote = false;");
    for (const userData of users) {
        const user = new MatrixUser(userData.userid, JSON.parse(userData.json));
        if (!user.get("accounts")) {
            continue;
        }
        // tslint:disable-next-line: no-any
        for (const [slack_id, account] of Object.entries<any>(user.get("accounts") || { })) {
            await db.none("INSERT INTO linked_accounts VALUES (${user_id}, ${slack_id}, ${team_id}, ${team_name})", {
                user_id: userData.userid,
                slack_id,
                team_id: account.team_id,
                team_name: account.team_name,
            });
        }
    }
}
