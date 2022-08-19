import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>): Promise<void> => {
    await db.none(`
        ALTER TABLE puppets ADD CONSTRAINT puppets_slackteam_matrixuser_unique UNIQUE(slackteam, matrixuser);`);
};
