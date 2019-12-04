import { Main } from "../Main";
import { RoomEntry, TeamEntry } from "../datastore/Models";
import { WebClient } from "@slack/web-api";
import { DMRoom } from "./DMRoom";
import { BridgedRoom } from "../BridgedRoom";

export function fromEntry(main: Main, entry: RoomEntry, team?: TeamEntry, botClient?: WebClient) {
    const slackType = entry.remote.slack_type;
    const opts = {
        inbound_id: entry.remote_id,
        matrix_room_id: entry.matrix_id,
        slack_channel_id: entry.remote.id,
        slack_channel_name: entry.remote.name,
        slack_team_id: entry.remote.slack_team_id,
        slack_webhook_uri: entry.remote.webhook_uri,
        puppet_owner: entry.remote.puppet_owner,
        is_private: entry.remote.slack_private,
        slack_type: entry.remote.slack_type,
    };
    if (slackType === "im" || slackType === "mpim") {
        if (!team) {
            throw Error("'team' is undefined, but required for DM rooms");
        }
        if (!botClient) {
            throw Error("'botClient' is undefined, but required for DM rooms");
        }
        return new DMRoom(main, opts, team, botClient);
    }
    return new BridgedRoom(main, opts, team, botClient);
}
