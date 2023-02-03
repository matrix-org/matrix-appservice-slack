FROM node:18-bullseye-slim AS BUILD

# git is needed to install Half-Shot/slackdown
RUN apt update && apt install -y git
WORKDIR /build

COPY package.json yarn.lock tsconfig.json ./

RUN yarn --ignore-scripts --pure-lockfile --network-timeout 600000

COPY ./src /build/src/

RUN yarn build

FROM node:18-bullseye-slim

VOLUME /data/ /config/

WORKDIR /usr/src/app
COPY package.json yarn.lock /usr/src/app/
RUN apt update && apt install git -y && yarn --network-timeout 600000 --production --pure-lockfile && yarn cache clean

COPY ./config /usr/src/app/config
COPY ./templates /usr/src/app/templates
COPY --from=BUILD /build/lib /usr/src/app/lib

EXPOSE 9898
EXPOSE 5858

ENTRYPOINT [ "node", "lib/app.js", "-c", "/config/config.yaml" ]
CMD [ "-f", "/config/slack-registration.yaml" ]
