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

const cli = new Cli({
    bridgeConfig: {
        defaults: {},
        affectsRegistration: true,
        schema: path.join(__dirname, "../config/slack-config-schema.yaml"),
    },
    registrationPath: "slack-registration.yaml",
    generateRegistration(reg, callback) {
        const config = cli.getConfig() as IConfig|null;
        if (!config) {
            throw Error('Config not ready');
        }
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("slackbot");
        reg.addRegexPattern("users", `@${config.username_prefix}.*:${config.homeserver.server_name}`, true);
        callback(reg);
    },
    run(cliPort: number, rawConfig: Record<string, undefined>|null, registration: any) {
        const config = rawConfig as IConfig|null;
        if (!config) {
            throw Error('Config not ready');
        }
        Logging.configure(config.logging || {});
        const log = Logging.get("app");
        // Format config
        const main = new Main(config, registration);
        main.run(cliPort).then((port) => {
            log.info("Matrix-side listening on port", port);
        }).catch((ex) => {
            log.error("Failed to start:", ex);
            process.exit(1);
        });

        process.on("SIGTERM", async () => {
            log.info("Got SIGTERM");
            try {
                await main.killBridge();
            } catch (ex) {
                log.warn("Failed to kill bridge, exiting anyway");
            }
            process.exit(1);
        });
    },
});
cli.run();
