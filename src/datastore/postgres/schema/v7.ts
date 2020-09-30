import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>): Promise<void> => {
    await db.none(`
        ALTER TABLE puppets DROP CONSTRAINT puppets_slackteam_key;
        ALTER TABLE puppets DROP CONSTRAINT puppets_matrixuser_key;`);
};
