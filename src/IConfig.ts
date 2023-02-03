/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// This should follow the format in slack-config-schema.yaml

type LogEnum = "error"|"warn"| "info"|"debug"|"off";
import { WebClientOptions } from "@slack/web-api";
import { ITeamSyncConfig } from "./TeamSyncer";
import { AllowDenyConfig } from "./AllowDenyList";

export const CACHING_DEFAULTS = {
    ghostUserCache: 100,
    matrixUserCache: 100,
};

export interface IConfig {
    inbound_uri_prefix?: string;
    username_prefix: string;

    matrix_admin_room?: string;

    rmau_limit?: number;
    user_activity?: {
        min_user_active_days?: number;
        inactive_after_days?: number;
    };

    homeserver: {
        url: string;
        server_name: string;
        media_url?: string;
        max_upload_size?: number;
        appservice_port?: number;
        appservice_host?: string;
    };

    encryption?: {
        enabled: boolean;
        pantalaimon_url: string;
    };

    tls?: {
        key_file: string;
        crt_file: string;
    };

    bot_profile?: {
        displayname?: string;
        avatar_url?: string;
    }

    caching?: {
        ghostUserCache: number,
        matrixUserCache: number,
    };

    logging: {
        console: LogEnum;
        fileDatePattern?: string;
        timestampFormat?: string;
        files?: {[filename: string]: LogEnum}
    };

    oauth2?: {
        client_id: string;
        client_secret: string;
        redirect_prefix?: string;
        html_template?: string;
    };

    rtm?: {
        enable: boolean;
        log_level?: string;
    };

    slack_hook_port?: number;
    slack_client_opts?: WebClientOptions;
    enable_metrics: boolean;

    db?: {
        engine: "postgres"|"nedb";
        connectionString: string;
    };

    team_sync?: {[teamId: string]: ITeamSyncConfig};

    dbdir: string;

    provisioning?: {
        enabled: boolean;
        require_public_room?: boolean;
        allow_private_channels?: boolean;
        limits?: {
            team_count?: number;
            room_count?: number;
        };
        channel_adl?: {
            allow: string[];
            deny: string[];
        }
    };

    puppeting?: {
        enabled: boolean;
        onboard_users?: boolean;
        direct_messages?: AllowDenyConfig;
    }
}
