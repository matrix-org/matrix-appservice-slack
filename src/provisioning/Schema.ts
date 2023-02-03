import Ajv, { JSONSchemaType } from "ajv";

export const ajv = new Ajv({
    allErrors: true,
    coerceTypes: true,
});

export interface GetAuthUrlBody {
    puppeting: boolean,
}
const getAuthUrlBodySchema: JSONSchemaType<GetAuthUrlBody> = {
    type: "object",
    properties: {
        puppeting: { type: "boolean", default: false },
    },
    required: ["puppeting"]
};
export const isValidGetAuthUrlBody = ajv.compile(getAuthUrlBodySchema);

export interface LogoutBody {
    slack_id: string,
}
const logoutBodySchema: JSONSchemaType<LogoutBody> = {
    type: "object",
    properties: {
        slack_id: { type: "string" },
    },
    required: ["slack_id"],
};
export const isValidLogoutBody = ajv.compile(logoutBodySchema);

export interface ListChannelsBody {
    team_id: string,
}
const listChannelsBodySchema: JSONSchemaType<ListChannelsBody> = {
    type: "object",
    properties: {
        team_id: { type: "string" },
    },
    required: ["team_id"],
};
export const isValidListChannelsBody = ajv.compile(listChannelsBodySchema);

export interface GetLinkBody {
    matrix_room_id: string,
}
const getLinkBodySchema: JSONSchemaType<GetLinkBody> = {
    type: "object",
    properties: {
        matrix_room_id: { type: "string" },
    },
    required: ["matrix_room_id"],
};
export const isValidGetLinkBody = ajv.compile(getLinkBodySchema);

export interface GetChannelInfoBody {
    channel_id: string,
    team_id: string,
}
const getChannelInfoBodySchema: JSONSchemaType<GetChannelInfoBody> = {
    type: "object",
    properties: {
        channel_id: { type: "string" },
        team_id: { type: "string" },
    },
    required: ["channel_id", "team_id"]
};
export const isValidGetChannelInfoBody = ajv.compile(getChannelInfoBodySchema);

export interface LinkBody {
    matrix_room_id: string,
    channel_id?: string,
    slack_webhook_uri?: string,
    team_id?: string,
}
const linkBodySchema: JSONSchemaType<LinkBody> = {
    type: "object",
    properties: {
        matrix_room_id: { type: "string" },
        channel_id: { type: "string", nullable: true },
        slack_webhook_uri: { type: "string", nullable: true },
        team_id: { type: "string", nullable: true },
    },
    required: ["matrix_room_id"]
};
export const isValidLinkBody = ajv.compile(linkBodySchema);

export interface UnlinkBody {
    matrix_room_id: string,
}
const unlinkBodySchema: JSONSchemaType<UnlinkBody> = {
    type: "object",
    properties: {
        matrix_room_id: { type: "string" },
    },
    required: ["matrix_room_id"],
};
export const isValidUnlinkBody = ajv.compile(unlinkBodySchema);
