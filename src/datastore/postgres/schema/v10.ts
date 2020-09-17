import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {

    await db.none(`
        CREATE TABLE encryption_sessions (
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            access_token TEXT NOT NULL
        );
        CREATE UNIQUE INDEX encryption_sessions_idx ON encryption_sessions (user_id);
    `);
}
