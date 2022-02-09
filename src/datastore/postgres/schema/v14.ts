import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export const runSchema = async (db: IDatabase<unknown>) => {
    await db.none(`
        CREATE TABLE custom_emoji (
            slack_team_id TEXT NOT NULL,
            name TEXT NOT NULL,
            mxc TEXT NOT NULL
        );
        CREATE UNIQUE INDEX custom_emoji_slack_idx ON custom_emoji (slack_team_id, name);
    `);
};
