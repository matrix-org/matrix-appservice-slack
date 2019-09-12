/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {
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
}
