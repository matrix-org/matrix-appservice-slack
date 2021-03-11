import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>) => {
    await db.none(`
        ALTER TABLE encryption_sessions ADD COLUMN sync_token TEXT;
    `);
};
