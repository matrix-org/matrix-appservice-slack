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

2. Name the app & select the team/workspace this app will belong to.

3. Click on `bot users` and add a new bot user. We will use this account to bridge the
   the rooms.

6. Click on `Install App` and `Install App to Workspace`. Note the access tokens show.
   You will need the `Bot User OAuth Access Token` and if you want to bridge files, the
   `OAuth Access Token` whenever you link a room.

7. For each channel you would like to bridge, perform the following steps:

   1. Create a Matrix room in the usual manner for your client. Take a note of its
      Matrix room ID - it will look something like `!aBcDeF:example.com`.

   2. Invite the Matrix bot user to the Matrix channel you would like to bridge.

       ```
       /invite @Slackbot:my.server.here
       ```

       This is the same command used to invite the bot to the Admin Control Room. Note
       that you may have to wait for the Slackbot to accept the invitation.

   3. Invite the Slack bot user to the Slack channel you would like to bridge.

       ```
       /invite @bot-user-name
       ```

       You will also need to determine the "channel ID" that Slack uses to identify
       the channel. Right-click your channel name in Slack and select "Copy Link".
       The channel id is the last argument in the url
       (`https://XXX.Slack.com/messages/<channel id>/`)

   4. Issue a ``link`` command in the administration control room with these
      collected values as arguments:

         ```
         link --channel_id CHANNELID --room !the-matrix:room.id --slack_bot_token xoxb-xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxx
         ```
