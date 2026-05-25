#!/usr/bin/env bash
set -euo pipefail

MANAGER_URL="${MANAGER_URL:-https://raw.githubusercontent.com/qqrrooty/realm-web-manager/main/manager.sh}"
SCRIPT_PATH="${SCRIPT_PATH:-/root/realm}"
INSTALL_WEB_PATH="${INSTALL_WEB_PATH:-/root/realm-install-web.sh}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

if ! command -v curl >/dev/null 2>&1; then
  $SUDO apt-get update
  $SUDO apt-get install -y curl ca-certificates
fi

if [ -f manager.sh ]; then
  $SUDO install -m 755 manager.sh "$SCRIPT_PATH"
  if [ -f install-web.sh ]; then
    $SUDO install -m 755 install-web.sh "$INSTALL_WEB_PATH"
  fi
else
  curl -fsSL "$MANAGER_URL" | $SUDO tee "$SCRIPT_PATH" >/dev/null
  $SUDO chmod +x "$SCRIPT_PATH"
fi

$SUDO ln -sf "$SCRIPT_PATH" /usr/local/bin/realm
$SUDO ln -sf "$SCRIPT_PATH" /usr/local/bin/realm-web-manager

echo "Realm Web Manager 管理脚本已安装"
echo "脚本路径: $SCRIPT_PATH"
echo "SSH 输入 realm 打开管理脚本，然后在脚本里安装面板"
