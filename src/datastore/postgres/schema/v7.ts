import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export const runSchema = async(db: IDatabase<any>): Promise<void> => {
    // Drop constraints
    await db.none(`
        ALTER TABLE puppets DROP CONSTRAINT puppets_slackteam_key;
        ALTER TABLE puppets DROP CONSTRAINT puppets_matrixuser_key;`);
};
