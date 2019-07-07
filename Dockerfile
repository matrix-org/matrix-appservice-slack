FROM node:current-alpine

VOLUME /data/ /config/

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install --only=production

EXPOSE 9898
EXPOSE 5858

ENTRYPOINT [ "node", "app.js", "-c", "/config/config.yaml" ]
CMD [ "-p", "5858", "-f", "/config/slack-registration.yaml" ]
