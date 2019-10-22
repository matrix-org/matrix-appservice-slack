Datastores
==========

Version 1.0+ supports using PostgreSQL as a storage backend instead of the
deprecated NeDB storage backend.
The required version of PostgreSQL is at least 9.5, but we recommend using the lastest stable version
available to you. Follow the installation instructions on the [official website](https://www.postgresql.org/download/)
or pull a [docker container](https://hub.docker.com/_/postgres).

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

Note: depending on your environment, the default PostgreSQL configuration might be set up such that it can be
reached only from localhost. Make sure it is reachable from your bridge installation. If necessary, set up
[`listen_addresses`](https://www.postgresql.org/docs/current/runtime-config-connection.html) and
[authentication](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html) for your needs.

Remember to choose conservative options to ensure security of your database!

NeDB End-of-life
--------

NeDB is a library which is used to store json documents locally to disk to give the bridge some local persistent state. 
All deployments of this bridge before `1.0` will have been using NeDB.

Starting with version `1.0`, NeDB will be deprecated and shouldn't be used for new installations. NeDB is
[unmaintained](https://github.com/matrix-org/matrix-appservice-bridge/issues/77) and doesn't scale well for the
needs of this bridge. Features such as puppeting will not be supported, however existing functionality will continue
to be maintained until support for NeDB is removed. 

Migrating from an existing NeDB installation
--------------------------------------------

From a checkout of the code base you can run:

```sh
npm run build
node lib/scripts/migrateToPostgres.js "connectionString" "dbDir" "slackPrefix"
```

If you use docker you can run:

```sh
docker run --entrypoint "node" -it -v /dbDir:/data  matrixdotorg/matrix-appservice-slack:latest "/usr/src/app/lib/scripts/migrateToPostgres.js" "connectionString" "/data" "slackPrefix"
```

(Note the docker container will need to be able to access the postgres port, so you might need `--network host` or to set the ip address to the host etc.)

Where you should replace:
- `connectionString` with the value above (such as `postgresql://slackbridge_user:somethingverysecret@localhost/slack_bridge?sslmode=require`)
- `dbDir` with the absolute path to your data files
- `slackPrefix` with the prefix of your slack ghost users (e.g. "@slack_")

Once this process has completed and no errors have occured, you may begin using
your brand new PostgreSQL database.
