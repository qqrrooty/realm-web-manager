#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/qqrrooty/realm-web-manager.git}"
APP_DIR="${APP_DIR:-/opt/realm-web-manager}"
SCRIPT_PATH="${SCRIPT_PATH:-/root/realm}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    docker --version
    echo "Docker 已安装"
    return
  fi
  echo "正在安装 Docker..."
  if ! command -v curl >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y curl ca-certificates
  fi
  curl -fsSL https://get.docker.com | $SUDO sh
  docker --version
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo ""
  fi
}

public_ip() {
  curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -fsSL --max-time 5 https://ifconfig.me 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || true
}

install_docker

COMPOSE="$(compose_cmd)"
if [ -z "$COMPOSE" ]; then
  echo "未找到 Docker Compose，请先安装 Docker Compose"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  $SUDO apt-get update
  $SUDO apt-get install -y git
fi

$SUDO mkdir -p "$(dirname "$APP_DIR")"

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  $SUDO git pull
else
  $SUDO git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

if [ ! -f .env ]; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | awk '{print $1}')"
  printf 'REALM_SESSION_SECRET=%s\n' "$SECRET" | $SUDO tee .env >/dev/null
fi

if [ -f manager.sh ]; then
  $SUDO install -m 755 manager.sh "$SCRIPT_PATH"
  $SUDO ln -sf "$SCRIPT_PATH" /usr/local/bin/realm
  $SUDO ln -sf "$SCRIPT_PATH" /usr/local/bin/realm-web-manager
fi

$SUDO $COMPOSE up -d --build

PANEL_PATH="$($SUDO docker exec realm-web-manager sh -c 'cat /data/web-path 2>/dev/null' 2>/dev/null || true)"
[ -n "$PANEL_PATH" ] || PANEL_PATH="/"

PUBLIC_IP="$(public_ip)"

echo "Realm Web Manager 已安装/更新"
if [ -n "$PUBLIC_IP" ]; then
  echo "当前访问地址: http://${PUBLIC_IP}:18765${PANEL_PATH}"
else
  echo "当前访问地址: http://服务器IP:18765${PANEL_PATH}"
fi
