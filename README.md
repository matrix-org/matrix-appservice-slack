# matrix-appservice-slack
A Matrix &lt;--> Slack bridge

This bridge allows you to connect Slack channels to Matrix rooms.

Installation
------------

```sh
$ git clone ...
$ cd matrix-appservice-slack
$ npm install
$ npm run build
```

How it Works:
------------
The bridge's server listens on two ports: One for events from your matrix
homeserver and one for events from slack. This tutorial will walk you through
configuring your homeserver and slack to send messages to this bridge and
setting up the api so this bridge can relay those message (all messages) to
the other bridged channel. Since reaching your Matrix homeserver requires
a unique link with another port, your bridge will use a total of three unique
ports and a slack app. For the sake of this tutorial, we will assume your
homeserver is hosted on the same server as this bridge at the port `8008`
(http://localhost:8008).

If you've set up other bridges, you're probably familiar with the link used
to reach your homeserver, the "homeserver url". This is the same URL. This
is the same port. No problem! Multiple bridges can plug into the same
homeserver url without conflicting with each other.

NOTE: If your bridge and homeserver run on different machines, you will need
to introduce proxying into the mix, which is beyond the scope of this readme.
There are some really awesome and kind people in the Matrix community. If you're
ever stuck, you can post a question in the [Matrix Bridging channel]
(https://matrix.to/#/#bridges:matrix.org).

Setup
-----

1. Create a new Matrix room to act as the administration control room. Note its
   internal room ID (EX: !abcdefg12345hijk:coolserver.com).

1. Pick/decide on two spare local TCP port numbers to use. One will listen for
   messages from Matrix and needs to be visible to the homeserver. The other
   will listen for messages from Slack and needs to be visible to the  internet
   This may require looking up your public IP address, or adding a section
   to your web server config to publicize the slack port. Take care to configure
   firewalls appropriately. These ports will be notated as `$MATRIX_PORT` and
   `$SLACK_PORT` in the remaining instructions.

1. Create a `config.yaml` file for global configuration. There is a sample
<<<<<<< HEAD
   one to begin with in `config/config.sample.yaml` you may wish to copy and
   edit as appropriate. The required and optional values are flagged in the config.


1. See [datastores](docs/datastores.md) on how to setup a database with the bridge.

1. Generate the appservice registration file. This will be used by the
   matrix homeserver. Here, you must specify the direct link the
   **Matrix Homserver** can use to access the bridge, including the matrix
   port it will send messages through (if this bridge runs on the same
   machine you can use `localhost` as the `$HOST` name):

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

1. Copy the newly-generated `slack-registration.yaml` file to your matrix
   homeserver. Add the registration file to your homeserver config (default
   `homeserver.yaml`):

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

NOTE: At the time of writing, Riot does not recognize the Slack bot. This is
okay. The bot *is there*... probably. Either way, when Riot asks if you're
sure you want to invite @slackbot, just say yes.

The bridge bot will stay offline for most of the time. This is normal. You
will know if the bridge is working (and that your homeserver is properly
connected) if it accepts your invitation. You can expect the bot to accept
within 45 seconds of being invited. If it never accepts the invitation,
check your bridge's logs and review the above steps.

The bridge itself should now be running. Congrats!

To actually use it, you will need to configure some linked channels.

Provisioning
------------

This bridge allows linking together pairs of Matrix rooms and Slack channels,
relaying messages said by people in one side into the other. To create a link,
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

4. Click on `Event Subscriptions` and enable them. At this point, the bridge needs to be
   started as Slack will do some verification of the request url. The request url is the
   inbound uri from your config file (the publically visible link to your bridge's slack
   port). Then add the following events as either bot user events or workspace events (it
   changes little) and save:

      - team_domain_change
      - message.channels
      - message.groups (if you want to bridge private channels)
      - chat:write:bot
      - users:read
      - team.info
      
      - reaction_added
      - reaction_removed

5. Skip this step if you do not want to bridge files.
   Click on `OAuth & Permissions` and add the following scopes:

   - files:write:user
   - reactions:write

   Note: In order to make Slack files visible to matrix users, this bridge will make Slack files
   visible to anyone with the url (including files in private channels). This is different
   than the current behavior in Slack, which only allows authenticated access to media
   posted in private channels. See [MSC701](https://github.com/matrix-org/matrix-doc/issues/701)
   for details.

6. Click on `Install App` and `Install App to Workspace`. Note the access tokens show.
   You will need the `Bot User OAuth Access Token` and if you want to bridge files, the
   `OAuth Access Token` whenever you link a room.

7. For each channel you would like to bridge, perform the following steps:

   1. Create a Matrix room in the usual manner for your client. Take a note of its
      Matrix room ID - it will look something like `!aBcDeF:example.com`.

   2. Invite the matrix bot user to the Matrix channel you would like to bridge.

       ```
       /invite @slackbot:my.server.here
       ```

       This is the same command used to invite the bot to the Admin Control Room. Note
       that you may have to wait for the slackbot to accept the invitation.

   3. Invite the slack bot user to the Slack channel you would like to bridge.

       ```
       /invite @bot-user-name
       ```

       You will also need to determine the "channel ID" that Slack uses to identify
       the channel. Right-click your channel name in slack and select "Copy Link".
       The channel id is the last argument in the url
       (`https://XXX.slack.com/messages/<channel id>/`)

   4. Issue a ``link`` command in the administration control room with these
      collected values as arguments:

      with file bridging:

         ```
         link --channel_id CHANNELID --room !the-matrix:room.id --slack_bot_token xoxb-xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxx --slack_user_token xoxp-xxxxxxxx-xxxxxxxxx-xxxxxxxx-xxxxxxxx
         ```
      without file bridging:

         ```
         link --channel_id CHANNELID --room !the-matrix:room.id --slack_bot_token xoxb-xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxx
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

**NOTE**: If you ever want to unlink a channel, you can issue an ``unlink`` command:
```
unlink --room matrix_room_id
```

See also https://github.com/matrix-org/matrix-appservice-bridge/blob/master/HOWTO.md for the general theory of all this :)

------------

#### Docker

NOTE: The following instructions may be outdated. Be sure to inquire at the official
[Matrix Bridging Room](https://matrix.to/#/#bridges:matrix.org) if you run into any problems

Following the instructions above, generate a registration file. The file may also be hand-crafted if you're familiar with the layout. You'll need this file to use the Docker image.

```
# Create the volume where we'll keep the bridge's files
mkdir -p /matrix-appservice-slack

# Create the configuration file. Use the sample configuration file as a template.
# Be sure to set the database paths to something like this:
#  database:
#    userStorePath: "/data/user-store.db"
#    roomStorePath: "/data/room-store.db"
#  dbdir: "/data"
nano /matrix-appservice-slack/config.yaml

# Copy the registration file to the volume
cp slack-registration.yaml /matrix-appservice-slack/slack-registration.yaml

# Recommended: Build the container yourself (requires a git clone, and to be in the root of the project)
docker build -t matrix-appservice-slack.

# Run the container (this image is unnoficial. The docs will be updated when the official one is online)
docker run -v /matrix-appservice-slack:/usr/src/app:z matrix-appservice-slack
```

#### Proxying

If you want to host this bridge on a different server than your homeserver, you will have
to proxy the bridge so both the matrix port (specified when creating your registration file
through the -u property) and the slack port (specified by the inbound_uri prefix in your
config file) can be reached. This way both the matrix homeserver and the slack API can reach
your bridge.

#### Mattermost

Because Mattermost's webhook APIs are Slack-compatible, the Matrix &lt;--> Slack bridge
also works with it. The webhook configuration is very similar to Slack's and is
documented on [Mattermost's website](https://www.mattermost.org/webhooks/).
