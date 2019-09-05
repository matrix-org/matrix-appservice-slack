Datastores
==========

Version 1.0+ supports using Postgres as a storage backend instead of the
legacy NeDB storage backend. If you wish to take advantage of this, please
read on.

NeDB EOL
--------

NeDB is a library which is used to store json documents locally to disk to give the bridge some local persistent state.
Until 1.0, it was the only way to store this information. 1.0 brings in support for PostgreSQL.

After version `1.0`, NeDB will also be deprecated and shouldn't be used for new installations. NeDB is
unmaintained[1] and doesn't scale well for the needs of this bridge. Changes such as **puppeting** will
not be supported, but existing functionality will continue to be maintained until such a time that it
is removed. 

Support for alternative datastores is something that may be included in the future, subject to demand.


- [1] https://github.com/matrix-org/matrix-appservice-bridge/issues/77

Using postgresql
----------------

You must first create a fresh database on an postgresql instance, create a user and grant the user
permission on the bridge:

```sql
CREATE DATABASE slack_bridge;
CREATE USER slackbridge_user WITH PASSWORD 'something very secret';
GRANT ALL PRIVILEGES ON DATABASE "slack" to slackbridge_user;
```

You should then update the config with details about the new database.

```yaml
db:
   engine: "postgres"
   connectionString: "postgresql://slackbridge_user:pass@localhost/slack_bridge"
```

(replacing pass with the password set above)

Ensure that `dbdir` is not included in the config.

Finally **if you are migrating from an existing NeDB install**, then you should run:

```bash
npm run build # If you've not built the bridge already
node lib/scripts/migrateToPostgres.js "db.connectionString" "dbdir"
```

where you should replace `connectionString` with the value above, and `dbdir` *if* you stored
your data files in a custom location.

Once this process has completed and no errors have occured, you may begin using
your brand new postgresql database.
