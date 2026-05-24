#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/qqrrooty/realm-web-manager.git}"
APP_DIR="${APP_DIR:-/opt/realm-web-manager}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker 未安装，请先安装 Docker"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "未找到 Docker Compose v2，请先安装 Docker Compose"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git 未安装，请先安装 Git"
  exit 1
fi

sudo mkdir -p "$(dirname "$APP_DIR")"

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  sudo git pull
else
  sudo git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

if [ ! -f .env ]; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | awk '{print $1}')"
  printf 'REALM_SESSION_SECRET=%s\n' "$SECRET" | sudo tee .env >/dev/null
fi

sudo docker compose up -d --build

PUBLIC_IP="$(
  curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -fsSL --max-time 5 https://ifconfig.me 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || true
)"

echo "Realm Web Manager 已启动"
if [ -n "$PUBLIC_IP" ]; then
  echo "请访问 http://${PUBLIC_IP}:18765"
else
  echo "未能自动获取服务器 IP，请手动访问 http://你的服务器IP:18765"
fi
echo "首次打开页面时会要求初始化管理员账号"
