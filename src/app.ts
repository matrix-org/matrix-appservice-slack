import { Logging, Cli, AppServiceRegistration } from "matrix-appservice-bridge";
import { Main } from "./Main"; 

const cli = new Cli({
    registrationPath: "slack-registration.yaml",
    bridgeConfig: {
        schema: "config/slack-config-schema.yaml",
        affectsRegistration: true
    },
    generateRegistration: function(reg, callback) {
        var config = cli.getConfig();
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart(config.bot_username);
        reg.addRegexPattern("users", "@" + config.username_prefix + ".*", true);
        callback(reg);
    },
    run: function(port, config, registration) {
        Logging.configure(config.logging || {});
        Logging.get("app").info("Matrix-side listening on port", port);
        new Main(config).run(port);
    },
});
cli.run();
