import { Response } from "express";
import Ajv, {JSONSchemaType, ValidateFunction} from "ajv";
import { ApiError, ErrCode, IApiError } from "matrix-appservice-bridge";

const ajv = new Ajv({
    allErrors: true,
    coerceTypes: true,
    useDefaults: true,
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

export class ValidationError extends ApiError {
    constructor(validator: ValidateFunction) {
        super(
            "Malformed request",
            ErrCode.BadValue,
            undefined,
            {
                errors: ajv.errorsText(validator.errors),
            },
        );
    }
}

export enum SlackErrCode {
    UnknownAccount = "SLACK_UNKNOWN_ACCOUNT",
    UnknownTeam = "SLACK_UNKNOWN_TEAM",
    UnknownChannel = "SLACK_UNKNOWN_CHANNEL",
    UnknownLink = "SLACK_UNKNOWN_LINK",
    NotEnoughPower = "SLACK_NOT_ENOUGH_POWER",
    BridgeAtLimit = "SLACK_BRIDGE_AT_LIMIT",
}

const ErrCodeToStatusCode: Record<SlackErrCode, number> = {
    [SlackErrCode.UnknownAccount]: 404,
    [SlackErrCode.UnknownTeam]: 404,
    [SlackErrCode.UnknownChannel]: 404,
    [SlackErrCode.UnknownLink]: 404,
    [SlackErrCode.NotEnoughPower]: 403,
    [SlackErrCode.BridgeAtLimit]: 500
};

export class SlackProvisioningError extends Error implements IApiError {
    constructor(
        public readonly error: string,
        public readonly errcode: SlackErrCode,
        public readonly statusCode = -1,
        public readonly additionalContent: Record<string, unknown> = {},
    ) {
        super(`API error ${errcode}: ${error}`);
        if (statusCode === -1) {
            this.statusCode = ErrCodeToStatusCode[errcode];
        }
    }

    get jsonBody(): { errcode: string, error: string } {
        return {
            errcode: this.errcode,
            error: this.error,
            ...this.additionalContent,
        };
    }

    public apply(response: Response): void {
        response.status(this.statusCode).send(this.jsonBody);
    }
}
