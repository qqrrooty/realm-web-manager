FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=18765
ENV REALM_RUNTIME=docker
ENV REALM_DIR=/data/realm
ENV REALM_CONFIG=/data/config.toml
ENV REALM_WEB_LOG=/data/realm_web_manager.log
ENV REALM_USERS_FILE=/data/users.json
ENV REALM_CRON_STATE=/data/restart-schedule.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar git openssl docker.io \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data

VOLUME ["/data"]
EXPOSE 18765

CMD ["node", "server.js"]
