FROM node:18-alpine as build

RUN mkdir /app
WORKDIR /app
COPY . .
RUN npm ci --omit dev

FROM alpine
RUN apk add --update nodejs
RUN mkdir /app
COPY --from=build /app /app
WORKDIR /app
COPY config.docker.js config.js

CMD [ "node", "index.js" ]
