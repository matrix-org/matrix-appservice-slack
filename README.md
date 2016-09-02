# matrix-appservice-slack
A Matrix &lt;--> Slack bridge

This is currently a very barebones bridge, it just does basic text in
pre-enumerated channels. It will become more exciting.

Installation
------------

```sh
$ git clone ...
$ cd matrix-appservice-slack
$ npm install
```


Setup
-----

1. Pick/decide on two spare local TCP port numbers to use. One will listen for
   messages from Matrix and needs to be visible to the homeserver. The other
   will listen for messages from Slack and needs to be visible to the internet.
   Take care to configure firewalls appropriately. These ports will be notated
   as `$MATRIX_PORT` and `$SLACK_PORT` in the remaining instructions.

1. Create a `config.yaml` file for global configuration. There is a sample
   one to begin with in `config/config.sample.yaml` you may wish to copy and
   edit as appropriate.

   At minimum this needs to contain:

   ```yaml
   slack_hook_port: $SLACK_PORT
   bot_username: "localpart for the bot's own user account"
   username_prefix: "localpart prefix for generated ghost users"

   homeserver:
     url: "http URL pointing at the homeserver"
     server_name: "domain part of the homeserver's name. Used for
                   ghost username generation"

   rooms: []
   ```

   For now we will leave the rooms list empty, but we will return to this
   subject later on.

1. Generate the appservice registration file (if the application service runs
   on the same server you can use `localhost` as the `$HOST` name):

   ```sh
   $ node app.js -r -c config.yaml -u "http://$HOST:$MATRIX_PORT"
   ```

1. Start the actual application service. You can use forever

   ```sh
   $ forever start app.js -c config.yaml -p $MATRIX_PORT
   ```

   or node

   ```sh
   $ node app.js -c config.yaml -p $MATRIX_PORT
   ```

1. Copy the newly-generated `slack-registration.yaml` file to the homeserver.
   Add the registration file to your homeserver config (default `homeserver.yaml`):

   ```yaml
   app_service_config_files:
      - ...
      - "/path/to/slack-registration.yaml"
   ```

   Don't forget - it has to be a YAML list of strings, not just a single string.

   Restart your homeserver to have it reread the config file an establish a
   connection to the bridge.

The bridge itself should now be running.

To actually use it, you will need to configure some linked channels.


Provisioning
------------

To set up on the Slack side:
 * Add inbound & outbound webhook integrations to the room you want to bridge.
 * For the inbound webhook, note down the URL that slack provisions for you - e.g. https://hooks.slack.com/services/ABC/DEF/123
 * For the outbound webhook, you'll need to expose your bridge to the internet and hand the URL to slack - e.g. http://slackbridge.domain.com:9000
 * You'll also need to determine the 'token' and 'channel ID' that slack uses to talk to you.  The easiest way to do this is to send a message from Slack to the bridge; the bridge will log the token & channel ID of the unrecognised message it just received.
 * Add the channel ID, token, room ID and slack webhook URL as an entry in the rooms list in the bridge's config.yaml and restart.

See also https://github.com/matrix-org/matrix-appservice-bridge/blob/master/HOWTO.md for the general theory of all this :)
