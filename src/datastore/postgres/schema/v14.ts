import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>) => {
    await db.none(`
        ALTER TABLE events ALTER COLUMN roomid TEXT NOT NULL;
        ALTER TABLE events ALTER COLUMN eventid TEXT NOT NULL;
        ALTER TABLE events ALTER COLUMN slackchannel TEXT NOT NULL;
        ALTER TABLE events ALTER COLUMN slackts TEXT NOT NULL;
        ALTER TABLE events ALTER COLUMN extras TEXT NOT NULL;
    `);
};
