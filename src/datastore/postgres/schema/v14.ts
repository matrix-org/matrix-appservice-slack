import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>) => {
    await db.none(`
        ALTER TABLE events
            ALTER COLUMN roomid SET NOT NULL,
            ALTER COLUMN eventid SET NOT NULL,
            ALTER COLUMN slackchannel SET NOT NULL,
            ALTER COLUMN slackts SET NOT NULL,
            ALTER COLUMN extras SET NOT NULL;
    `);
};
