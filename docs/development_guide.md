Development Guide
-----------------

This guide is for those that want to help hack on the Slack bridge, and
need some instruction on how to set it up. This is **not** a guide for
setting up an instance for production usage.

For information on how to contribute issues and or pull requests, please
read [CONTRIBUTING](../CONTRIBUTING.md).

## Setting up your environment

This section explains how to setup Synapse, Riot and the Slack bridge
for local development.

### 0. Prerequisites 

Ensure at the minimum you have installed:

- NodeJS ([nvm](https://github.com/nvm-sh/nvm) is a good tool for this)
- Docker
- `psql` shell utility for accessing the database
   - On Debian/Ubuntu based systems you can install `postgresql-client`
   - On a Mac, this is `libpg`

Docker is used here to reduce the number of requirements on the host system,
and will allow you to setup your environment faster.

For the sake of making this easier to follow, we will create a directory in
our home directory called `slack-bridge-env`:

```bash
mkdir ~/slack-bridge-env
cd ~/slack-bridge-env
```

### 1. Setting up Synapse

Synapse is the reference implementation of a Matrix homeserver. You may use other
homeserver implementations that support the AS API, but for the sake of simplicity
this is how to setup Synapse.

To generate your config:

```bash
docker run -it --rm \
    -v ~/slack-bridge-env/synapse:/data \
    -e SYNAPSE_SERVER_NAME=localhost \
    -e SYNAPSE_REPORT_STATS=no \
    matrixdotorg/synapse:v1.3.1-py3 generate
```

Open the generated `homeserver.yaml` file for editing. 
Find and uncomment the `enable_registration` field, set it to `true`:

```yaml
enable_registration: true
```

You will need to add an appservice registration file in the future,
but it is not important for now.


And then to run the homeserver:

```bash
docker run -d --name synapse \
    -v ~/slack-bridge-env/synapse:/data \
    -p 8008:8008 \
    matrixdotorg/synapse:v1.3.1-py3
```

These instructions are based off those given in https://hub.docker.com/r/matrixdotorg/synapse.


### 2. Setting up Riot

Setting up Riot is also quite straightforward:

Create a new config called `~/slack-bridge-env/riot-config.json` with the contents
needed to set defaults to your local homeserver.

As an example:

```json
{
    "default_server_config": {
        "m.homeserver": {
            "base_url": "http://localhost:8008",
            "server_name": "localhost"
        }
    },
    "disable_custom_urls": false,
    "disable_guests": false,
    "disable_login_language_selector": false,
    "disable_3pid_login": false,
    "brand": "Riot",
    "defaultCountryCode": "GB",
    "showLabsSettings": false,
    "default_federate": true,
    "default_theme": "light"
}
```

Finally, run `docker run -v /home/will/git/scalar-env/riot-config.json:/app/config.json -p 8080:80 vectorim/riot-web`
to start your Riot instance. You should be able to register a new user on your
local synapse instance through Riot.

### 3. Setting up the bridge with PostgreSQL

You can setup PostgreSQL in docker.

```bash
docker run -d --name slackpg -p 59999:5432 -e POSTGRES_PASSWORD=pass postgres
```

You should also create a new database in preparation for using the bridge

```bash
psql -h localhost -U postgres -W postgres
```

And then on the postgres shell:

```sql
CREATE DATABASE slack
```

### 4. Setting up the bridge

Clone the bridge repo to a place of your choice, again for simplicity we will
use the env directory. Make sure you clone your **fork** and not the upstream repo.

```bash
git clone git@github.com:your-github-username/matrix-appservice-slack.git
cd matrix-appservice-slack
git remote add matrix-org git@github.com:matrix-org/matrix-appservice-slack.git
git checkout matrix-org/develop # Always base your changes off matrix-org/develop
npm i
npm run build
```

The steps above should make sure you are running the latest development version
and have built the typescript. To ensure that it's all working, you can run
`npm test` which will run the unit and integration tests. 

You can follow the instructions in the [README](../README.md), under the to generate and update the
registration file. You should follow the "Recommended - Events API" to setup a Slack app. This guide
strongly recommends using the RTM API for local development as it does not require a webserver.

Make sure that you copy the generated registration file to `~/slack-bridge-env/synapse` and
add an entry for it in the `homeserver.yaml` before starting the synapse container.

## Making changes

Whenever you want to make changes to the codebase, you must:

```bash
git fetch matrix-org
git checkout matrix-org/develop
git checkout -b yourfeaturename
npm i
```

You should always work within the `src` directory. It is helpful to have a code editor setup
with linting enabled so you can see mistakes as you work. Always remember to run `npm run build`
before commiting or testing so that you know the latest changes work.  

Before commiting your work, ensure that the tests pass locally with `npm test`. If you are making
changes to packages, ensure that `package-lock.json` is included in the commit.
