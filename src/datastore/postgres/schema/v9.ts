import { IDatabase } from "pg-promise";

// tslint:disable-next-line: no-any
export async function runSchema(db: IDatabase<any>) {

    await db.none(`
        CREATE TABLE reactions (
            room_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            slack_channel_id TEXT NOT NULL,
            slack_message_ts TEXT NOT NULL,
            reaction TEXT NOT NULL
        );
        CREATE UNIQUE INDEX reaction_matrix_idx ON reactions (room_id, event_id);
        CREATE UNIQUE INDEX reaction_slack_idx ON reactions (slack_channel, slack_message_ts, reaction);
    `);
}
