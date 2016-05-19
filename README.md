# matrix-appservice-slack
A Matrix &lt;--> Slack bridge

This is currently a very barebones bridge, it just does basic text in
pre-enumerated channels. It will become more exciting.

To install:
```
$ npm install
```

Then fill out a config.yaml file according to the example in
config/config.sample.yaml and run the following commands:

Register your application service with your homeserver:
```
$ node app.js -r -c config.yaml -u "http://localhost:9000"
```

Reference the resulting registration yaml file from your homeserver's homeserver.yaml config and restart the server to pick it up.

Start your application service:
```
$ node app.js -p 9000 -c config.yaml
```

To set up on the Slack side:
 * Add inbound & outbound webhook integrations to the room you want to bridge.
 * For the inbound webhook, note down the URL that slack provisions for you - e.g. https://hooks.slack.com/services/ABC/DEF/123
 * For the outbound webhook, you'll need to expose your bridge to the internet and hand the URL to slack - e.g. http://slackbridge.domain.com:9000
 * You'll also need to determine the 'token' and 'channel ID' that slack uses to talk to you.  The easiest way to do this is to send a message from Slack to the bridge; the bridge will log the token & channel ID of the unrecognised message it just received.
 * Add the channel ID, token, room ID and slack webhook URL as an entry in the rooms list in the bridge's config.yaml and restart.

See also https://github.com/matrix-org/matrix-appservice-bridge/blob/master/HOWTO.md for the general theory of all this :)