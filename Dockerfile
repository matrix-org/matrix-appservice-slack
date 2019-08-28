FROM node:current-alpine AS BUILD
COPY . /tmp/src

RUN apk add git
RUN cd /tmp/src \
    && npm install \
    && npm run build

FROM node:current-alpine

VOLUME /data/ /config/

COPY package.json /usr/src/app/
COPY package-lock.json /usr/src/app/

COPY --from=BUILD /tmp/src/lib /usr/src/app/lib

WORKDIR /usr/src/app

# git is needed to install Half-Shot/slackdown
RUN apk add git && npm install --only=production

EXPOSE 9898
EXPOSE 5858

ENTRYPOINT [ "node", "lib/app.js", "-c", "/config/config.yaml" ]
CMD [ "-p", "5858", "-f", "/config/slack-registration.yaml" ]
