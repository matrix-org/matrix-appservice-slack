import { IDatabase } from "pg-promise";
import { MatrixUser } from "matrix-appservice-bridge";

export const runSchema = async(db: IDatabase<unknown>) => {
    // Drop constraints
    await db.none(`
        ALTER TABLE puppets DROP CONSTRAINT puppets_slackteam_key;
        ALTER TABLE puppets DROP CONSTRAINT puppets_matrixuser_key;`);
};
