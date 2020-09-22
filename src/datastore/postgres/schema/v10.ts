import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export const runSchema = async(db: IDatabase<any>) => {
    await db.none(`
        CREATE TABLE emojis (
            slack_team_id TEXT NOT NULL,
            name TEXT NOT NULL,
            mxc TEXT NOT NULL
        );
        CREATE UNIQUE INDEX emojis_slack_idx ON emojis (slack_team_id, name);
    `);
};
