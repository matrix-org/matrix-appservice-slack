import { Logging, Cli, AppServiceRegistration } from "matrix-appservice-bridge";
import { Main } from "./Main";
import { IConfig } from "./IConfig";

const cli = new Cli({
    bridgeConfig: {
        affectsRegistration: true,
        schema: "config/slack-config-schema.yaml",
    },
    registrationPath: "slack-registration.yaml",
    generateRegistration(reg, callback) {
        const config = cli.getConfig();
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart(config.bot_username);
        reg.addRegexPattern("users", `@${config.username_prefix}.*`, true);
        callback(reg);
    },
    run(port: number, config: IConfig) {
        Logging.configure(config.logging || {});
        const log = Logging.get("app");
        new Main(config).run(port).then(() => {
            log.info("Matrix-side listening on port", port);
        }).catch((ex) => {
            log.get("Failed to start:", ex);
            process.exit(1);
        });
    },
});
cli.run();
