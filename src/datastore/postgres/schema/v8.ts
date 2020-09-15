import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export const runSchema = async(db: IDatabase<any>) => {
    await db.none(`
        CREATE INDEX events_matrix_idx ON events (roomid, eventid);
        CREATE INDEX events_slack_idx ON events (slackchannel, slackts);`);
}
