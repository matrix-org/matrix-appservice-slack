import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<any>): Promise<void> => {
    await db.none(`CREATE TABLE user_admin_rooms (
        roomid TEXT UNIQUE NOT NULL,
        matrixuser TEXT UNIQUE NOT NULL
    );`);
};
