import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {
    // Create schema
    await db.none(`
        CREATE TABLE metrics_users (
            user_id TEXT NOT NULL PRIMARY KEY,
            remote BOOLEAN NOT NULL
        );

        CREATE TYPE room_type AS ENUM ('user', 'channel');
        CREATE TABLE metrics_rooms (
            room_id TEXT NOT NULL PRIMARY KEY,
            team_id TEXT NOT NULL,
            type room_type NOT NULL
        );

        CREATE TABLE metrics_user_room_activities (
            user_id TEXT NOT NULL,
            room_id TEXT NOT NULL,
            date DATE,
            CONSTRAINT cons_user_room_activities_unique UNIQUE(user_id, room_id, date),
            CONSTRAINT cons_user_room_activities_room
                FOREIGN KEY(room_id) REFERENCES metrics_rooms(room_id)
        );
    `);
}
