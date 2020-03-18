# Linking Channels

This bridge allows linking together pairs of Matrix rooms and Slack channels,
relaying messages said by people in one side into the other. To create a link,
first the individual Matrix room and Slack channel need to be created, and then
a command needs to be issued in the administration console room to add the link
to the bridge's database.

## RTM API

This is the newer and recommended way to use the bridge.

1. Add a custom app to your Slack team/workspace by visiting https://api.Slack.com/apps
   and clicking on `Create New App`.

1. Name the app & select the team/workspace this app will belong to.

1. Click on `Bots` and `Add Legacy Bot User`. We will use this account to bridge the
   the rooms.

1. Click on `Install App` in the sidebar and `Install App to Workspace`.

1. Click on `OAuth & Permissions` in the sidebar and note the access tokens shown.
   You will need the `Bot User OAuth Access Token` and if you want to bridge files and the
   `OAuth Access Token` whenever you link a room.

1. For each channel you would like to bridge, perform the following steps:

   1. Create a Matrix room in the usual manner for your client. Take a note of its
      Matrix room ID - it will look something like `!aBcDeF:example.com`.

   1. Invite the Matrix bot user to the Matrix room you would like to bridge.

       ```
       /invite @slackbot:my.server.here
       ```

       This is the same command used to invite the bot to the Admin Control Room. Note
       that you may have to wait for the Slackbot to accept the invitation.

   1. Invite the Slack bot user to the Slack channel you would like to bridge.

       ```
       /invite @bot-user-name
       ```

       You will also need to determine the "channel ID" that Slack uses to identify
       the channel. Right-click your channel name in Slack and select "Copy Link".
       The channel id is the last argument in the url
       (`https://XXX.slack.com/messages/<channel id>/`)

   1. Issue a ``link`` command in the administration control room with these
      collected values as arguments:

      ```
      link --channel_id CHANNELID --room !the-matrix:room.id --slack_bot_token xoxb-xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxx
      ```

## Webhooks

Linking rooms with webhooks is not the recommended way for most situations,
although it can be useful for single channels or if you are using Mattermost.

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

## Unlink Channels

If you ever want to unlink a channel, you can issue an ``unlink`` command:

```
unlink --room matrix_room_id
```

## Mattermost

Because Mattermost's webhook APIs are Slack-compatible, the Matrix &lt;--> Slack bridge
also works with it. The webhook configuration is very similar to Slack's and is
documented on [Mattermost's website](https://www.mattermost.org/webhooks/).
