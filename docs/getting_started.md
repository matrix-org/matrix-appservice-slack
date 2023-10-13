# Getting Started

In this guide we will setup the bridge connected to your homeserver. This guide
will walk through the most common settings, other options are documented in
the `config.sample.yaml` file.

## Installation

These instructions assume you are using Synapse 1.4.0+. They should
work for older releases and other homeservers, but configuration may vary.

### From source

```sh
$ git clone https://github.com/matrix-org/matrix-appservice-slack.git
$ cd matrix-appservice-slack
$ yarn # Will automatically build the package
```

### With Docker

```sh
$ docker pull matrixdotorg/matrix-appservice-slack:latest
```

## How it works

The bridge listens to events using the Slack RTM API over websockets, and to
Matrix events on a port that the homeserver sends events to. This tutorial will
walk you through configuring your homeserver and Slack to send messages to this
bridge and setting up the api so this bridge can relay those message (all
messages) to the other bridged channel. For the sake of this tutorial, we will
assume your homeserver is hosted on the same server as this bridge at the port
`8008` (http://localhost:8008).

If you've set up other bridges, you're probably familiar with the link used
to reach your homeserver, the "homeserver url". This is the same URL. This
is the same port. No problem! Multiple bridges can plug into the same
homeserver url without conflicting with each other.

NOTE: If your bridge and homeserver run on different machines, you will need
to introduce proxying into the mix, which is beyond the scope of these docs.
There are some really awesome and kind people in the Matrix community. If you're
ever stuck, you can post a question in the 
[Matrix Bridging room](https://matrix.to/#/#bridges:matrix.org).


## Setup

1. Create a new Matrix room to act as the administration control room. Note its
   internal room ID (Example: !abcdefg12345hijk:coolserver.com).

1. Decide on a spare local TCP port number to use. The default is 5858. It will listen for messages
   from Matrix and needs to be visible to the homeserver. Take care to configure
   firewalls appropriately. This port will be notated as `$MATRIX_PORT` in
   the remaining instructions. By default, this is 5858.

1. Create a `config/config.yaml` file for global configuration. There is a sample
   one to begin with in `config/config.sample.yaml`. You should copy and
   edit as appropriate. The required and optional values are flagged in the config.

  1. For `homeserver.server_name`, enter the server name, e.g. `matrix.example.com` or `localhost`.

  1. For `db`, see [datastores](datastores.md) on how to set up a database with the bridge.
  
  1. For `matrix_admin_room`, enter the internal room ID of the administration control
     room (Example: !abcdefg12345hijk:coolserver.com).
  
  1. For `homeserver.appservice_port`, specify the above $MATRIX_PORT if you overwrote the default.

  1. When using bridge in Docker container: For `appservice_port`, enter the value of
     `$MATRIX_PORT`, unless it is `5858`, which is the default.

1. Generate the appservice registration file. This will be used by the
   Matrix homeserver. Here, you must specify the direct link (the url field) the
   **Matrix Homserver** can use to access the bridge, including the Matrix
   port it will send messages through (if this bridge runs on the same
   machine you can use `localhost` as the `$HOST` name):
   
    `$ yarn start -r -c config/config.yaml -u "http://$HOST:$MATRIX_PORT"`
   or with docker:
   
   ```sh
   $ docker run --volume /path/to/config/:/config/ matrixdotorg/matrix-appservice-slack \ 
      -r -c /config/config.yaml -u "http://$HOST:$MATRIX_PORT" -f /config/slack-registration.yaml
   ```

1. Start the actual application service:

   ```sh
   $ yarn start -c config/config.yaml -p $MATRIX_PORT
   ```
   or with docker:
   
   ```ssh
   $ docker run --detach --volume /path/to/config/:/config/ matrixdotorg/matrix-appservice-slack
   ```

1. Copy the newly-generated `slack-registration.yaml` file to your Matrix
   homeserver. Add the registration file to your homeserver config (default
   `homeserver.yaml`):
   
   ```yaml
    app_service_config_files:
      - ...
      - "/path/to/slack-registration.yaml"
   ```

   Don't forget - it has to be a YAML list of strings, not just a single string.

   Restart your homeserver to have it reread the config file and establish a
   connection to the bridge.

1. Invite the bridge bot user into the admin room, so it can actually see and
   respond to commands. The bot's user ID is formed from the `sender_localpart`
   field of the registration file, and the homeserver's domain name. For example:

   ```
   /invite @slackbot:my.server.here
   ```

NOTE: At the time of writing, Element does not recognize the Slack bot. This is
okay. The bot *is there*. If Element asks if you're sure you want to invite
@slackbot, just say yes.

The bridge bot will stay offline for most of the time. This is normal. You
will know if the bridge is working (and that your homeserver is properly
connected) if it accepts your invitation. You can expect the bot to accept
within 45 seconds of being invited. If it never accepts the invitation,
check your bridge's logs and review the above steps.

The bridge itself should now be running. Congrats!

To actually use it, you will need to configure some linked channels, see
[linking channels](link_channels.md).

Once a Slack Workspace is connected, you can offer automatic hints on how
to bridge existing and new channels by enabling [Workspace Sync](team_sync.md).

## Upgrading
1. Build the latest version of the application service. [Follow the Installation section instructions.](#installation)
1. Restart the application service.

Note: You do NOT need to regenerate an appservice registration file.

## Proxying

If you want to host this bridge on a different server than your homeserver, you will have
to proxy the bridge so both the Matrix port (specified when creating your registration file
through the -u property) and the Slack port (specified by the inbound_uri prefix in your
config file) can be reached. This way both the Matrix homeserver and the Slack API can reach
your bridge.
