import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>) => {
    await db.none(`
        CREATE TABLE user_activity (
            user_id TEXT UNIQUE,
            data JSON
        );
    `);
};
