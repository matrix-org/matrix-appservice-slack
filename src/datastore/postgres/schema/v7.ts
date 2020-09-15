import { IDatabase } from "pg-promise";
import { MatrixUser } from "matrix-appservice-bridge";

// tslint:disable-next-line: no-any
export const runSchema = async(db: IDatabase<any>) => {
    // Drop constraints
    await db.none(`
        ALTER TABLE puppets DROP CONSTRAINT puppets_slackteam_key;
        ALTER TABLE puppets DROP CONSTRAINT puppets_matrixuser_key;`);
}
