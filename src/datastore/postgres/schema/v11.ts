import { IDatabase } from "pg-promise";

export const runSchema = async (db: IDatabase<unknown>): Promise<void> => {
    // In 2020, when metrics_activities were introduced, there was a bug that caused
    // months to be zero-based (one number lower than expected).
    // https://github.com/matrix-org/matrix-appservice-slack/issues/552

    // UNIQUE contraints cannot be deferred, so we drop it and re-add it after the migration.
    await db.none(`
        ALTER TABLE metrics_activities DROP CONSTRAINT cons_activities_unique;
    
        UPDATE metrics_activities set date = date + interval '1 month';
        
        ALTER TABLE metrics_activities ADD CONSTRAINT cons_activities_unique UNIQUE(user_id, room_id, date);
    `);
};
