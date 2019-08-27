// This should follow the format in slack-config-schema.yaml

type LogEnum = "error"|"warn"| "info"|"debug"|"off";

export interface IConfig {
    inbound_uri_prefix: string;
    bot_username: string;
    username_prefix: string;

    matrix_admin_room?: string;

    homeserver: {
        url: string;
        server_name: string;
        media_url?: string;
    };

    tls: {
        key_file: string;
        crt_file: string;
    };

    logging: {
        console: LogEnum;
        fileDatePattern: string;
        timestampFormat: string;
        files: {[filename: string]: LogEnum}
    };

    oauth2?: {
        client_id: string;
        client_secret: string;
        redirect_prefix?: string;
    };

    enable_rtm: boolean;

    slack_hook_port?: number;

    enable_metrics: boolean;

    dbdir: string;
}
