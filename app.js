const bridgeLib = require("matrix-appservice-bridge");

const Main = require("./lib/Main");

const Cli = bridgeLib.Cli;
const AppServiceRegistration = bridgeLib.AppServiceRegistration;
const Logging = bridgeLib.Logging;

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
    run: function(port, config) {
        Logging.configure(config.logging || {});
        Logging.get("app").info("Matrix-side listening on port %s", port);
        (new Main(config)).run(port);
    },
});
cli.run();
