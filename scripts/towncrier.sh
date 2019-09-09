#!/bin/bash
VERSION=`node -e "console.log(require('./package.json').version)"`
towncrier --version $VERSION $1