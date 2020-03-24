import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {
    // Create schema
    await db.none(`
        CREATE TABLE schema (
            version	INTEGER UNIQUE NOT NULL
        );

        INSERT INTO schema VALUES (0);

        CREATE TABLE teams (
            id TEXT UNIQUE NOT NULL PRIMARY KEY,
            name TEXT,
            token TEXT,
            bot_id TEXT
        );

        CREATE TABLE rooms (
            id TEXT NOT NULL PRIMARY KEY,
            roomid TEXT NOT NULL,
            remoteid TEXT NOT NULL,
            json TEXT
        );

        CREATE TABLE users (
            userid TEXT UNIQUE NOT NULL PRIMARY KEY,
            isremote BOOLEAN,
            json TEXT
        );

        CREATE TABLE events (
            roomid TEXT,
            eventid TEXT,
            slackchannel TEXT,
            slackts TEXT,
            extras TEXT,
            CONSTRAINT cons_events_unique UNIQUE(eventid, roomid, slackchannel, slackts)
        );
    `);
}
