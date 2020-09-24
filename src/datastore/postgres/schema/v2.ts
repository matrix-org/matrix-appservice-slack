import { IDatabase } from "pg-promise";

export const runSchema = async(db: IDatabase<unknown>): Promise<void> => {
    await db.none(`CREATE TABLE puppets (
        slackuser TEXT UNIQUE NOT NULL,
        slackteam TEXT UNIQUE NOT NULL,
        matrixuser TEXT UNIQUE NOT NULL,
        token TEXT,
        CONSTRAINT cons_puppets_uniq UNIQUE(slackuser, slackteam, matrixuser)
    );`);
};
