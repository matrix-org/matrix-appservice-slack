Development Guide
-----------------

This guide is for those that want to help hack on the Slack bridge, and need some instruction on how
to set it up. This is **not** a guide for setting up an instance for production usage.

For information on how to contribute issues and or pull requests, please read [CONTRIBUTING](../CONTRIBUTING.md).

## Setting up your environment

This section explains how to setup Synapse, Riot and the Slack bridge for local development.

### Prereqs 

Ensure at the minimum you have installed:

- NodeJS ( [nvm](https://github.com/nvm-sh/nvm) is a good tool for this)
- Docker (optional, but it will make your life easier)

For the sake of making this easier to follow, we will create a directory in the home directory
called `slack-bridge-env`:

```bash
mkdir ~/slack-bridge-env
cd ~/slack-bridge-env
```

### Setting up Synapse

Largely to setup Synapse, you can follow https://hub.docker.com/r/matrixdotorg/synapse and just ensure your data directory points to `~/slack-bridge-env/synapse`.  
You will want to make sure your server name is something that routes to your local box. I tend to use the devbox hostname, but `localhost` is also sufficent.  
You should enable registration in the `homeserver.yaml` to create a testing user.  
You will need to add an appservice registration file in the future, but it is not imprtant for now.

### Setting up Riot

Setting up Riot is also quite straightforward:

Create a new config called `~/slack-bridge-env/riot-config.json` with the contents needed to set defaults to your local homeserver.

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

Finally, run `docker run -v /home/will/git/scalar-env/riot-config.json:/app/config.json -p 8080:80 vectorim/riot-web` to start your Riot instance. You should be able to register a new user on your local synapse instance through Riot.

### Setting up the bridge postgres

Setting up the postgres instance for the bridge is also quite easy.

```bash
docker run -d --name slackpg -p 59999:5432 -e POSTGRES_PASSWORD=pass postgres
```

You should also create a new database in preparation for using the bridge

```bash
sudo apt install postgresql-client # Ensure you have psql installed
psql -h localhost -U postgres -W postgres
```

And then on the postgres shell

```sql
CREATE DATABASE slack
```

### Setting up the bridge

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

You can follow the instructions in the [README](../README.md) to generate and update the registration file, as well as creating a testing Slack app and workspace. You should enable RTM support in the config, as Slack will not be able to push events to your local bridge.

Make sure that you copy the generated registration file to `~/slack-bridge-env/synapse` and add an entry for it in the `homeserver.yaml` before starting the synapse container.