FROM node:18-bullseye-slim AS BUILD

# git is needed to install Half-Shot/slackdown
RUN apt update && apt install -y git
WORKDIR /src

COPY package.json yarn.lock /src/

RUN yarn --ignore-scripts --pure-lockfile --network-timeout 600000

COPY . /src

RUN yarn build

FROM node:18-bullseye-slim

VOLUME /data/ /config/

WORKDIR /usr/src/app
COPY package.json yarn.lock /usr/src/app/
RUN apt update && apt install git -y && yarn --network-timeout 600000 --production --pure-lockfile && yarn cache clean

COPY --from=BUILD /src/config /usr/src/app/config
COPY --from=BUILD /src/templates /usr/src/app/templates
COPY --from=BUILD /src/lib /usr/src/app/lib

EXPOSE 9898
EXPOSE 5858

ENTRYPOINT [ "node", "lib/app.js", "-c", "/config/config.yaml" ]
CMD [ "-f", "/config/slack-registration.yaml" ]
