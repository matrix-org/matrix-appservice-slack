// Usage:
// The first time, run this first to register with your homeserver:
// node app.js -r -c config.yaml -u "http://localhost:9000"
// And any time after that:
// node app.js -p 9000 -c config.yaml
var qs = require("querystring");
var requestLib = require("request");
var Rooms = require("./lib/rooms");
var SlackHookHandler = require("./lib/slack-hook-handler");
var MatrixHandler = require("./lib/matrix-handler");
var Provisioner = require("./lib/provisioning.js").Provisioner;
var bridgeLib = require("matrix-appservice-bridge");
var bridge, provisioner;

function startServer(config, hookHandler, callback) {
    var createServer;
    if (config.tls) {
        var fs = require("fs");
        var tls_options = {
            key: fs.readFileSync(config.tls.key_file),
            cert: fs.readFileSync(config.tls.crt_file)
        };
        createServer = function(cb) {
            return require("https").createServer(tls_options, cb);
        };
    }
    else {
        createServer = require("http").createServer;
    }

    createServer(function(request, response) {
        console.log(request.method + " " + request.url);

        var body = "";
        request.on("data", function(chunk) {
            body += chunk;
        });

        request.on("end", function() {
            var params = qs.parse(body);
            if (hookHandler.checkAuth(params)) {
                hookHandler.handle(params);
            }
            else {
                console.log("Ignoring request with bad token: " + JSON.stringify(params));
            }
            response.writeHead(200, {"Content-Type": "application/json"});
            response.write(JSON.stringify({}));
            response.end();
        });
    }).listen(config.slack_hook_port, function() {
        var protocol = config.tls ? "https" : "http";
        console.log("Slack-side listening on port " +
            config.slack_hook_port + " over " + protocol);
        callback();
    });
}

var Cli = bridgeLib.Cli;
var Bridge = bridgeLib.Bridge;
var AppServiceRegistration = bridgeLib.AppServiceRegistration;

var cli = new Cli({
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
        var rooms = new Rooms(config);
        var matrixHandler = new MatrixHandler(config, rooms, requestLib);
        bridge = new Bridge({
            homeserverUrl: config.homeserver.url,
            domain: config.homeserver.server_name,
            registration: "slack-registration.yaml",

            controller: {
                onUserQuery: function(queriedUser) {
                    return {}; // auto-provision users with no additonal data
                },

                onEvent: function(request, context) {
                    matrixHandler.handle(request.getData());
                },
            }
        });
        var slackHookHandler = new SlackHookHandler(requestLib, config, rooms, bridge);
        startServer(config, slackHookHandler, function() {
            console.log("Matrix-side listening on port %s", port);
            bridge.run(port, config);

            console.log("Setting up provisioning...");
            provisioner = new Provisioner(bridge, rooms, true);
        });
    }
});
cli.run();
