FROM node:16-bullseye

RUN mkdir -p /node/app
COPY package.json /node/app
COPY src /node/app/src

WORKDIR "/node/app"
RUN yarn install

ENTRYPOINT ["node", "src/cli.js"]
