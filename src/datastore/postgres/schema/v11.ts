import { IDatabase } from "pg-promise";

export const runSchema = async (db: IDatabase<unknown>): Promise<void> => {
    // In 2020, when metrics_activities were introduced, there was a bug that caused
    // months to be zero-based (one number lower than expected).
    // https://github.com/matrix-org/matrix-appservice-slack/issues/552
    await db.none(`
        UPDATE metrics_activities set date = date + interval '1 month';
    `);
};
