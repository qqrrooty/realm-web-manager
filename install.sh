#!/usr/bin/env bash
set -euo pipefail

MANAGER_URL="${MANAGER_URL:-https://raw.githubusercontent.com/qqrrooty/realm-web-manager/main/manager.sh}"

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
  $SUDO install -m 755 manager.sh /usr/local/bin/realm
  $SUDO install -m 755 manager.sh /usr/local/bin/realm-web-manager
else
  curl -fsSL "$MANAGER_URL" | $SUDO tee /usr/local/bin/realm >/dev/null
  $SUDO chmod +x /usr/local/bin/realm
  $SUDO cp /usr/local/bin/realm /usr/local/bin/realm-web-manager
fi

echo "Realm Web Manager 管理脚本已安装"
echo "SSH 输入 realm 打开管理脚本，然后在脚本里安装面板"
