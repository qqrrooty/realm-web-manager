#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/qqrrooty/realm-web-manager.git}"
APP_DIR="${APP_DIR:-/opt/realm-web-manager}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker 未安装，正在安装 Docker..."
  if ! command -v curl >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y curl ca-certificates
  fi
  curl -fsSL https://get.docker.com | $SUDO sh
fi

COMPOSE="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  else
    echo "未找到 Docker Compose，请先安装 Docker Compose"
    exit 1
  fi
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git 未安装，正在安装 Git..."
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

$SUDO $COMPOSE up -d --build

if [ -f manager.sh ]; then
  $SUDO install -m 755 manager.sh /usr/local/bin/realm-web-manager
  $SUDO install -m 755 manager.sh /usr/local/bin/realm
fi

PANEL_PATH="$($SUDO docker exec realm-web-manager sh -c 'cat /data/web-path 2>/dev/null' 2>/dev/null || true)"
if [ -z "$PANEL_PATH" ]; then
  PANEL_PATH="/"
fi

PUBLIC_IP="$(
  curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -fsSL --max-time 5 https://ifconfig.me 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || true
)"

echo "Realm Web Manager 已启动"
if [ -n "$PUBLIC_IP" ]; then
  echo "请访问 http://${PUBLIC_IP}:18765${PANEL_PATH}"
else
  echo "未能自动获取服务器 IP，请手动访问 http://你的服务器IP:18765${PANEL_PATH}"
fi
echo "首次打开页面时会要求初始化管理员账号"
echo "SSH 管理脚本命令: realm"
