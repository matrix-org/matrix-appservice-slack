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

This bridge allows linking together pairs of Matrix rooms and Slack channels,
relaying messages said by people in one side into the other. To create a link
first the individual Matrix room and Slack channel need to be created, and then
the application service config file updated with details of their
configuration.

1. Create a Matrix room in the usual manner for your client. Take a note of its
   Matrix room ID - it will look something like `!aBcDeF:example.com`.

1. Create a Slack channel in the usual manner.

1. Add an "Incoming WebHooks" integration to the Slack channel and take a note
   of its "Webhook URL" from the integration settings in Slack - it will look
   something like `https://hooks.slack.com/services/ABC/DEF/123`.

1. Add an "Outgoing WebHooks" integration to the Slack channel and take a note
   of its `token` field. Add a URL to this web hook pointing back at the
   application service port you configured during setup.

   You will also need to determine the "channel ID" that Slack uses to identify
   the channel. Unfortunately, it is not easily obtained from the Slack UI. The
   easiest way to do this is to send a message from Slack to the bridge; the
   bridge will log the channel ID as part of the unrecognised message output.
   You can then take note of the `channel_id` field.

1. Add the information collected above into a new entry in the `rooms` list in
   `config.yaml`:

   ```yaml
   rooms:
      - ...
      - matrix_room_id: "Matrix room ID collected in step 1."
        webhook_url: "Slack Incoming WebHook URL collected in step 3."
        slack_channel_id: "Slack channel ID collected in step 4."
        slack_api_token: "Slack Outgoing Webook Token collected in step 4."
   ```

1. Restart the application service. You should now find that messages are
   pushed in both directions by the application service.

See also https://github.com/matrix-org/matrix-appservice-bridge/blob/master/HOWTO.md for the general theory of all this :)
