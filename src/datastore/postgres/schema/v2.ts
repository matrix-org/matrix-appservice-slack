import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export const runSchema = async(db: IDatabase<any>) => {
    await db.none(`CREATE TABLE puppets (
        slackuser TEXT UNIQUE NOT NULL,
        slackteam TEXT UNIQUE NOT NULL,
        matrixuser TEXT UNIQUE NOT NULL,
        token TEXT,
        CONSTRAINT cons_puppets_uniq UNIQUE(slackuser, slackteam, matrixuser)
    );`);
};
