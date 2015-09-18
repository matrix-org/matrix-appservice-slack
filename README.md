# matrix-appservice-slack
A Matrix &lt;--> Slack bridge

This is currently a very barebones bridge, it just does basic text in
pre-enumerated channels. It will become more exciting.

To install:
```
$ npm install
```

Then fill out a config.yaml file according to the example in
config/config.sample.yaml and run the following commands:

Register your application service with your homeserver:
```
$ node app.js -r -c config.yaml -u "http://localhost:9000"
```

Start your application service:
```
$ node app.js -p 9000 -c config.yaml
```
