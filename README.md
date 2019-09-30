# Matrix-appservice-slack
A Matrix &lt;--&gt; Slack bridge

This bridge allows you to connect Slack channels to Matrix rooms.


See (the docs)[docs/index.md] for instructions on how to set up the bridge.

### Legacy - Webhooks

1. Create a Matrix room in the usual manner for your client. Take a note of its
   Matrix room ID - it will look something like `!aBcDeF:example.com`.

1. Create a Slack channel in the usual manner.

1. Add an "Incoming WebHooks" integration to the Slack channel and take a note
   of its "Webhook URL" from the integration settings in Slack - it will look
   something like `https://hooks.Slack.com/services/ABC/DEF/123`.

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
   link --channel_id CHANNELID --room !the-matrix:room.id --webhook_url https://hooks.Slack.com/services/ABC/DEF/123
   ```

   These arguments can be shortened to single-letter forms:

   ```
   link -I CHANNELID -R !the-matrix:room.id -u https://hooks.Slack.com/services/ABC/DEF/123
   ```

**NOTE**: If you ever want to unlink a channel, you can issue an ``unlink`` command:
```
unlink --room Matrix_room_id
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
cp Slack-registration.yaml /matrix-appservice-slack/Slack-registration.yaml

# Recommended: Build the container yourself (requires a git clone, and to be in the root of the project)
docker build -t Matrix-appservice-slack.

# Run the container (this image is unnoficial. The docs will be updated when the official one is online)
docker run -v /matrix-appservice-slack:/usr/src/app:z Matrix-appservice-slack
```

#### Proxying

If you want to host this bridge on a different server than your homeserver, you will have
to proxy the bridge so both the Matrix port (specified when creating your registration file
through the -u property) and the Slack port (specified by the inbound_uri prefix in your
config file) can be reached. This way both the Matrix homeserver and the Slack API can reach
your bridge.

#### Mattermost

Because Mattermost's webhook APIs are Slack-compatible, the Matrix &lt;--> Slack bridge
also works with it. The webhook configuration is very similar to Slack's and is
documented on [Mattermost's website](https://www.mattermost.org/webhooks/).
