# Filing Issues
A good issue can mean the difference between a quick fix and a long, painful fixing process. That's why the
following guidelines exist:

 - Write a short title which neatly summaries the *problem* or *feature*. Do **not** write the *solution* in the issue title.
   For example: `Substrings of pills should not turn into Slack mentions` is a good issue title. `Filter nicks according to RFC 2812`
   is not a good issue title.
 - Give a summary and as much information (along with proposed solutions) as possible in the body of the issue.
 - Include reproduction steps where possible.
 - Provide the commit SHA or version number of the Slack bridge being used.
 - If known, provide the method being used to bridge. This might be webhooks, RTM or the Events API.

# Making Pull Requests
This project follows "git flow" semantics. In practice, this means:
 - The `master` branch is latest current stable release.
 - The `develop` branch is where all the new code ends up.
 - When forking the project, branch from `develop` and then write your code.
 - Make sure your new code passes all the code checks (tests and linting). Do this by running
   `npm run test` and `npm run lint`.
 - Create a pull request. If this PR fixes an issue, link to it by referring to its number.
 - You must [sign off your pull requests](https://github.com/matrix-org/synapse/blob/master/CONTRIBUTING.rst#sign-off)

## Coding notes
The Slack bridge uses Typescript as it's language, which is then compiled into JavaScript using `npm run build`.
Developers should be aware that we are currently targetting Node 10, which means we can support any features from
`ES2017`. The Typescript compiler should ensure you do not use unsupported features for the version of Node targetted.
 
Tests are run using Mocha. Assertions should be made using `chai`. There are good examples of tests
in the `src/tests` directory.

## Release notes
 - Changes are put in `CHANGELOG.md`.
 - Each formal release corresponds to a branch which is of the form `vX.Y.Z` where `X.Y.Z` maps
   directly onto the `package.json` (NPM) version.
 - Releases are also tagged so they are present on the Releases page on Github.

## Building the documentation

You can build a rendered version of the help documentation by using `mkdocs`.

This requires you to have `python3` and `pip` installed.

```sh
# For Debian-based platforms
$ apt install python3 python3-pip
$ pip3 install -r docs/requirements.txt
mkdocs serve
```
