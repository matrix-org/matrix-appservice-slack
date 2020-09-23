import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>) => {
    await db.none(`
        CREATE TABLE encryption_sessions (
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            access_token TEXT NOT NULL
        );
        CREATE UNIQUE INDEX encryption_sessions_idx ON encryption_sessions (user_id);
    `);
};
