# Matrix-appservice-slack
A Matrix &lt;--&gt; Slack bridge

This bridge allows you to connect Slack channels to Matrix rooms.

See (the docs)[docs/index.md] for instructions on how to set up the bridge.


See also https://github.com/matrix-org/matrix-appservice-bridge/blob/master/HOWTO.md for the general theory of all this :)

------------


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
