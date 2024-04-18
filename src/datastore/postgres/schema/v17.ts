import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>) => {
    await db.none(`
        ALTER TABLE events DROP CONSTRAINT cons_events_unique;
    `);

    await db.none(`
        ALTER TABLE events ADD CONSTRAINT cons_events_unique UNIQUE(eventid, roomid, slackchannel, slackts, extras);
    `);
};
