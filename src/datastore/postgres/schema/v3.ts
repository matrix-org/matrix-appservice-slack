import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {
    await db.none(`
        ALTER TABLE teams ADD COLUMN status TEXT;
        ALTER TABLE teams ADD COLUMN domain TEXT;
        ALTER TABLE teams ADD COLUMN scopes TEXT;
    `);
}
