import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {
    await db.none(`CREATE TABLE user_admin_rooms (
        roomid TEXT UNIQUE NOT NULL,
        matrixuser TEXT UNIQUE NOT NULL
    );`);
}
