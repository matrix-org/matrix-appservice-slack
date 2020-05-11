FROM node:14-alpine AS BUILD
COPY . /src

# git is needed to install Half-Shot/slackdown
RUN apk add git
WORKDIR /src
RUN npm install
RUN npm run build

FROM node:14-alpine

VOLUME /data/ /config/

COPY package.json /usr/src/app/
COPY package-lock.json /usr/src/app/

COPY --from=BUILD /src/config /usr/src/app/config
COPY --from=BUILD /src/lib /usr/src/app/lib

WORKDIR /usr/src/app

RUN apk add git && npm install --only=production

EXPOSE 9898
EXPOSE 5858

ENTRYPOINT [ "node", "lib/app.js", "-c", "/config/config.yaml" ]
CMD [ "-p", "5858", "-f", "/config/slack-registration.yaml" ]
