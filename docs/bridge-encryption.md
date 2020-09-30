Bridge Encryption
=================

The Slack bridge supports end-to-end encryption (E2EE) rooms, using [pantalaimon](https://github.com/matrix-org/pantalaimon).
This means the bridge will encrypt messages when sending to E2EE rooms, and
will decrypt them to be sent to Slack. New direct messages (DMs) and private channels will also
be encrypted by default when bridged.

The end-to-end encryption is established between Matrix clients and the bridge. Messages going to and from Slack will be encrypted by HTTPS but won't use E2EE.
Bridge encryption secures conversation contents on all Matrix homeservers and clients it is sent to. Also, this may be advantageous
to users of [Enterprise Key Management](https://slack.com/intl/en-gb/enterprise-key-management).

## Setup

You must first [setup](https://github.com/matrix-org/pantalaimon#installation) the pantalaimon daemon.
This must be accessible by the bridge but SHOULD NOT be accessible to users of your homeserver. Docker users
should take care to ensure that the Pantalaimon container can be reached by the bridge container.

Then you should add the following to the configuration file:

```yaml
encryption:
  enabled: true
  pantalaimon_url: "http://127.0.0.1:8009"
```

Where `pantalaimon_url` is the URL where your bridge can reach the daemon.

Afterwards, any new DMs or private rooms will be encrypted. Also,  any existing rooms connected
to the bridge that have encryption enabled will also be encrypted going forward.

If you choose to disable this feature later, the bridge will not create new DM rooms, so you will
need to delete the existing encrypted rooms from the DB and start over.
