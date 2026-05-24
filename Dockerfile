FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=8765
ENV REALM_RUNTIME=docker
ENV REALM_DIR=/data/realm
ENV REALM_CONFIG=/data/config.toml
ENV REALM_WEB_LOG=/data/realm_web_manager.log
ENV REALM_USERS_FILE=/data/users.json
ENV REALM_CRON_STATE=/data/restart-schedule.json

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 8765

CMD ["node", "server.js"]
