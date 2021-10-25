# npm-package-repro

Downloads and builds npm packages from source, and compares with the published package.

## Running locally

To run the server:

```sh
yarn
yarn build-server
yarn run-server
```

To use the CLI:

```sh
yarn
node src/cli.js <package>
```

______

Notes:

```sh
docker build -t npm-package-repro-cli .
docker run --name npm-package-repro --network host -d -it -v $(pwd)/results:/node/app/results --entrypoint=/bin/sh npm-package-repro-cli
docker exec npm-package-repro node src/cli.js lighthouse --check-all-deps
```
