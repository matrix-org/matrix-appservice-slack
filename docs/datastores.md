Datastores
==========

Version 1.0+ supports using PostgreSQL as a storage backend instead of the
deprecated NeDB storage backend. 

NeDB End-of-life
--------

NeDB is a library which is used to store json documents locally to disk to give the bridge some local persistent state. 
All deployments of this bridge before `1.0` will have been using NeDB.

Starting with version `1.0`, NeDB will be deprecated and shouldn't be used for new installations. NeDB is
[unmaintained](https://github.com/matrix-org/matrix-appservice-bridge/issues/77) and doesn't scale well for the
needs of this bridge. Features such as puppeting will not be supported, however existing functionality will continue
to be maintained until support for NeDB is removed. 

Version 1.0 of the bridge only supports PostgreSQL as an alternative datastore.

Using PostgreSQL
----------------

You must first create a fresh database on an PostgreSQL instance, create a user and grant the user
permission on the bridge:

```sql
CREATE DATABASE slack_bridge;
CREATE USER slackbridge_user WITH PASSWORD 'somethingverysecret';
GRANT ALL PRIVILEGES ON DATABASE "slack" to slackbridge_user;
```

You should then update the config with details about the new database.

```yaml
db:
   engine: "postgres"
   connectionString: "postgresql://slackbridge_user:somethingverysecret@localhost/slack_bridge?sslmode=require"
```

(replacing "somethingverysecret" with your own password)

Ensure that `dbdir` is not included in the config.

Migrating from an existing NeDB installation
--------------------------------------------

```bash
npm run build
node lib/scripts/migrateToPostgres.js "connectionString" "dbdir"
```

Where you should replace `connectionString` with the value above (such as
`postgresql://slackbridge_user:somethingverysecret@localhost/slack_bridge?sslmode=require`), and `dbdir`
*if* you stored your data files in a custom location.

Once this process has completed and no errors have occured, you may begin using
your brand new PostgreSQL database.
