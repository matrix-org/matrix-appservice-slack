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

import { Logging, Cli, AppServiceRegistration } from "matrix-appservice-bridge";
import { Main } from "./Main";
import { IConfig } from "./IConfig";
import * as path from "path";

const DEFAULT_PORT = 5858;

// To avoid log spam - https://github.com/matrix-org/matrix-appservice-slack/issues/554
process.setMaxListeners(0);

const cli = new Cli({
    bridgeConfig: {
        defaults: {},
        affectsRegistration: true,
        schema: path.join(__dirname, "../config/slack-config-schema.yaml"),
    },
    registrationPath: "slack-registration.yaml",
    generateRegistration: (reg, callback) => {
        const config = cli.getConfig() as IConfig|null;
        if (!config) {
            throw Error('Config not ready');
        }
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("slackbot");
        reg.addRegexPattern("users", `@${config.username_prefix}.*:${config.homeserver.server_name}`, true);
        const teamSyncEntries = config.team_sync && Object.values(config.team_sync) || [];
        for (const teamEntry of teamSyncEntries) {
            if (teamEntry.channels?.alias_prefix) {
                reg.addRegexPattern("aliases", `#${teamEntry.channels?.alias_prefix}.*:${config.homeserver.server_name}`, true);
            }
        }
        callback(reg);
    },
    run: (cliPort: number|null, rawConfig: Record<string, undefined>|null, registration) => {
        const config = rawConfig as IConfig|null;
        if (!config) {
            throw Error('Config not ready');
        }
        Logging.configure(config.logging || {});
        const log = Logging.get("app");
        // Format config
        if (!registration) {
            throw Error('registration must be defined');
        }
        const main = new Main(config, registration);
        main.run(cliPort || config.homeserver.appservice_port || DEFAULT_PORT).then((port) => {
            log.info("Matrix-side listening on port", port);
        }).catch((ex) => {
            log.error("Failed to start:", ex);
            process.exit(1);
        });

        process.on("SIGTERM", () => {
            log.info("Got SIGTERM");
            main.killBridge().then(() => {
                process.exit(0);
            }).catch((ex) => {
                log.warn("Failed to kill bridge, exiting anyway", ex);
                process.exit(2);
            });
        });
    },
});
cli.run();
