import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {
    // Create schema
    await db.none(`
        CREATE TABLE metrics_activities (
            user_id TEXT NOT NULL,
            room_id TEXT NOT NULL,
            date DATE,
            CONSTRAINT cons_activities_unique UNIQUE(user_id, room_id, date),
            CONSTRAINT cons_activities_user FOREIGN KEY(user_id) REFERENCES users(userid),
            CONSTRAINT cons_activities_room FOREIGN KEY(room_id) REFERENCES rooms(id)
        );
    `);
}
