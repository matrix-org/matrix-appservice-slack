import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>) => {
    await db.none(`
        CREATE TABLE provisioner_sessions (
            user_id TEXT,
            token TEXT UNIQUE,
            expires_ts BIGINT
        );
    `);
};
