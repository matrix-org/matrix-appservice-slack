import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<any>): Promise<void> => {
    // Create schema
    await db.none(`CREATE TABLE schema (
        version	INTEGER UNIQUE NOT NULL
    );`);

    await db.none(`INSERT INTO schema VALUES (0);`);

    await db.none(`CREATE TABLE teams (
        id TEXT UNIQUE NOT NULL PRIMARY KEY,
        name TEXT,
        token TEXT,
        bot_id TEXT
    );`);

    await db.none(`CREATE TABLE rooms (
        id TEXT NOT NULL PRIMARY KEY,
        roomid TEXT NOT NULL,
        remoteid TEXT NOT NULL,
        json TEXT
    );`);

    await db.none(`CREATE TABLE users (
        userid TEXT UNIQUE NOT NULL PRIMARY KEY,
        isremote BOOLEAN,
        json TEXT
    );`);

    await db.none(`CREATE TABLE events (
        roomid TEXT,
        eventid TEXT,
        slackchannel TEXT,
        slackts TEXT,
        extras TEXT,
        CONSTRAINT cons_events_unique UNIQUE(eventid, roomid, slackchannel, slackts)
    );`);
};
