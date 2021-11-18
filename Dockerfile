FROM node:16-alpine AS BUILD

# git is needed to install Half-Shot/slackdown
RUN apk add git
WORKDIR /src

COPY package.json package-lock.json /src/
RUN npm install
COPY . /src
RUN npm run build

FROM node:16-alpine

VOLUME /data/ /config/

WORKDIR /usr/src/app
COPY package.json package-lock.json /usr/src/app/
RUN apk add git && npm install --only=production

COPY --from=BUILD /src/config /usr/src/app/config
COPY --from=BUILD /src/templates /usr/src/app/templates
COPY --from=BUILD /src/lib /usr/src/app/lib

EXPOSE 9898
EXPOSE 5858

ENTRYPOINT [ "node", "lib/app.js", "-c", "/config/config.yaml" ]
CMD [ "-f", "/config/slack-registration.yaml" ]
