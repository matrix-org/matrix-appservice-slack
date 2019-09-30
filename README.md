# matrix-appservice-slack
A Matrix &lt;--> Slack bridge

This bridge allows you to connect Slack channels to Matrix rooms.

Development
-----------

[![#slack:half-shot.uk](https://img.shields.io/matrix/slack:half-shot.uk.svg?server_fqdn=matrix.half-shot.uk&label=%23slack:half-shot.uk&logo=matrix)](https://matrix.to/#/#slack:half-shot.uk)

If you want to help out, please give our helpful [Development Guide](./docs/development_guide.md)
a read. It covers all you need to know to get hacking on the bridge.

Installation
------------

```sh
$ git clone ...
$ cd matrix-appservice-slack
$ npm install
$ npm run build
```

Setup
-----

1. Create a new Matrix room to act as the administration control room. Note its
   internal room ID.

1. Pick/decide on two spare local TCP port numbers to use. One will listen for
   messages from Matrix and needs to be visible to the homeserver. The other
   will listen for messages from Slack and needs to be visible to the internet.
   Take care to configure firewalls appropriately. These ports will be notated
   as `$MATRIX_PORT` and `$SLACK_PORT` in the remaining instructions.

1. Create a `config.yaml` file for global configuration. There is a sample
   one to begin with in `config/config.sample.yaml` you may wish to copy and
   edit as appropriate. The required and optional values are flagged in the config.


1. See [datastores](docs/datastores.md) on how to setup a database with the bridge.

1. Generate the appservice registration file (if the application service runs
   on the same server you can use `localhost` as the `$HOST` name):

   ```sh
   $ npm start -- -r -c config.yaml -u "http://$HOST:$MATRIX_PORT"
   ```

1. Start the actual application service. You can use forever

   ```sh
   $ forever start ./lib/app.js -c config.yaml -p $MATRIX_PORT
   ```

   or node

   ```sh
   $ npm start -- -c config.yaml -p $MATRIX_PORT
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

1. Invite the bridge bot user into the admin room, so it can actually see and
   respond to commands. The bot's user ID is formed from the `sender_localpart`
   field of the registration file, and the homeserver's domain name. For example:

   ```
   /invite @slackbot:my.server.here
   ```

The bridge itself should now be running.

To actually use it, you will need to configure some linked channels.

Provisioning
------------

This bridge allows linking together pairs of Matrix rooms and Slack channels,
relaying messages said by people in one side into the other. To create a link
first the individual Matrix room and Slack channel need to be created, and then
a command needs to be issued in the administration console room to add the link
to the bridge's database.

There are 2 ways to bridge a room. The recommended way uses the newer Slack events api
and bot users. This allows you to link as many channels as you would like with only
1 Slack integration. The legacy way uses incoming/outgoing webhooks, and requires
2 Slack integrations per channel to be bridged.

### Recommended - Events API

1. Add a custom app to your Slack team/workspace by visiting https://api.slack.com/apps
   and clicking on `Create New App`.

2. Name the app & select the team/workspace this app will belong to.

3. Click on `bot users` and add a new bot user. We will use this account to bridge the
   the rooms.

4. Click on `Event Subscriptions` and enable them. 

   1. You will need to decide on using either the **RTM API** or the **Events API**.  
      The RTM API is recommended because it does not require you to setup scopes or open ports
      to a webserver like the Events API.  
      Events API provisioning is forwards compatible with the RTM API and if enabled in the config,
      RTM is used by default.
      The RTM API uses websockets and will pull information from Slack, whereas the Events API will
      push informaton to the bridge over HTTP.

   2. If you want to use the RTM API, ensure that you have enabled RTM support in the
      config file. And then put your feet up, you are done.

   3. If you want to use the Events API, follow these steps:

      The bridge needs to be started as Slack will do some verification of the request url. The request url should be `https://$HOST:$SLACK_PORT"`. Then add the following events to "Subscribe to Bot Events" and save:

         - team_domain_change
         - message.channels
         - reaction_added
         - reaction_removed

5. Click on `OAuth & Permissions` and add the following scopes:

   - files:read (So the bot may upload files to Matrix)
   - files:write:user (Upload files from Matrix)
   - users:read (Profile information on users)
   - team:read (Get basic information about the workspace)
   - chat:write:bot (Write messages as the bridge bot)
   - reactions:write (Add/remove reactions on Slack)

   The following are needed if you plan to integrate the bridge with an Integration Manager:

   - channels:read (Used to fetch information about public channels on the workspace)

   Note: any media uploaded to matrix is currently accessible by anyone who knows the url.
   In order to make Slack files visible to matrix users, this bridge will make Slack files
   visible to anyone with the url (including files in private channels). This is different
   then the current behavior in Slack, which only allows authenticated access to media
   posted in private channels. See [MSC701](https://github.com/matrix-org/matrix-doc/issues/701)
   for details.

6. Click on `Install App` and `Install App to Workspace`. Note the access token shown.
   You will need the `OAuth Access Token` whenever you link a room.

7. For each channel you would like to bridge, perform the following steps:

   1. Create a Matrix room in the usual manner for your client. Take a note of its
      Matrix room ID - it will look something like `!aBcDeF:example.com`.

   2. Invite the bot user to the Slack channel you would like to bridge.

       ```
       /invite @bot-user-name
       ```

       You will also need to determine the "channel ID" that Slack uses to identify
       the channel, which can be found in the url `https://XXX.slack.com/messages/<channel id>/`.

   3. Issue a ``link`` command in the administration control room with these
      collected values as arguments:

         ```
         link --channel_id CHANNELID --room !the-matrix:room.id --slack_bot_token xoxb-xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxx --slack_user_token xoxp-xxxxxxxx-xxxxxxxxx-xxxxxxxx-xxxxxxxx
         ```

      These arguments can be shortened to single-letter forms:

         ```
         link -I CHANNELID -R !the-matrix:room.id -t xoxb-xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxx
         ```


### Legacy - Webhooks

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

1. Issue a ``link`` command in the administration control room with these
   collected values as arguments:

   ```
   link --channel_id CHANNELID --room !the-matrix:room.id --webhook_url https://hooks.slack.com/services/ABC/DEF/123
   ```

   These arguments can be shortened to single-letter forms:

   ```
   link -I CHANNELID -R !the-matrix:room.id -u https://hooks.slack.com/services/ABC/DEF/123
   ```

See also https://github.com/matrix-org/matrix-appservice-bridge/blob/master/HOWTO.md for the general theory of all this :)


Mattermost
----------

Because Mattermost's webhook APIs are Slack-compatible, the Matrix &lt;--> Slack bridge
also works with it. The webhook configuration is very similar to Slack's and is
documented on [Mattermost's website](https://www.mattermost.org/webhooks/).
