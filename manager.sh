#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/qqrrooty/realm-web-manager.git}"
APP_DIR="${APP_DIR:-/opt/realm-web-manager}"
CONTAINER_NAME="${CONTAINER_NAME:-realm-web-manager}"
PANEL_PORT="${PANEL_PORT:-18765}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

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

current_path() {
  $SUDO docker exec "$CONTAINER_NAME" sh -c 'cat /data/web-path 2>/dev/null' 2>/dev/null || true
}

show_url() {
  local path ip
  path="$(current_path)"
  [ -n "$path" ] || path="/"
  ip="$(public_ip)"
  if [ -n "$ip" ]; then
    echo "当前访问地址: http://${ip}:${PANEL_PORT}${path}"
  else
    echo "当前访问地址: http://服务器IP:${PANEL_PORT}${path}"
  fi
}

pause() {
  read -r -p "按回车键继续..."
}

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

install_manager() {
  install_docker
  local compose
  compose="$(compose_cmd)"
  if [ -z "$compose" ]; then
    echo "未找到 Docker Compose，请先安装 Docker Compose"
    return 1
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
    local secret
    secret="$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | awk '{print $1}')"
    printf 'REALM_SESSION_SECRET=%s\n' "$secret" | $SUDO tee .env >/dev/null
  fi
  $SUDO $compose up -d --build
  echo "Realm Web Manager 已安装/更新"
  show_url
}

uninstall_manager() {
  read -r -p "确认卸载 Realm Web Manager？[y/N]: " ok
  case "$ok" in
    y|Y)
      $SUDO docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
      $SUDO rm -rf "$APP_DIR"
      echo "Realm Web Manager 已卸载"
      ;;
    *) echo "已取消" ;;
  esac
}

start_manager() {
  $SUDO docker start "$CONTAINER_NAME"
}

stop_manager() {
  $SUDO docker stop "$CONTAINER_NAME"
}

restart_manager() {
  $SUDO docker restart "$CONTAINER_NAME"
}

write_path_and_restart() {
  local path="$1"
  $SUDO docker exec "$CONTAINER_NAME" sh -c "printf '%s\n' '$path' > /data/web-path"
  $SUDO docker restart "$CONTAINER_NAME" >/dev/null
  echo "Web 基础路径已修改为: $path"
  show_url
}

random_path() {
  local value
  value="/$(openssl rand -hex 8 2>/dev/null || date +%s%N | sha256sum | cut -c1-16)"
  write_path_and_restart "$value"
}

custom_path() {
  local value clean
  read -r -p "请输入自定义路径，例如 /my-secret-path: " value
  clean="${value#/}"
  clean="${clean%/}"
  if ! printf '%s' "$clean" | grep -Eq '^[a-zA-Z0-9_-]{6,48}$'; then
    echo "路径只能使用 6-48 位字母、数字、下划线或短横线"
    return 1
  fi
  write_path_and_restart "/$clean"
}

change_path_menu() {
  clear
  echo "修改 Web 基础路径"
  echo "1. 随机路径"
  echo "2. 自定义路径"
  echo "0. 返回"
  read -r -p "请输入你的选择 [0-2]: " choice
  case "$choice" in
    1) random_path ;;
    2) custom_path ;;
    0) return ;;
    *) echo "无效选择" ;;
  esac
}

show_menu() {
  local release panel_state autostart realm_state path
  release="$(. /etc/os-release 2>/dev/null && echo "${ID:-unknown}" || echo "unknown")"
  panel_state="$($SUDO docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "未安装")"
  autostart="$($SUDO docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
  path="$(current_path)"
  [ -n "$path" ] || path="未生成"
  if $SUDO docker exec "$CONTAINER_NAME" pgrep -x realm >/dev/null 2>&1; then
    realm_state="运行中"
  elif [ "$panel_state" = "running" ]; then
    realm_state="未运行"
  else
    realm_state="未知"
  fi

  clear
  echo "The OS release is: $release"
  echo
  echo "╔──────────────────────────────────────────────╗"
  echo "│   Realm Web Manager 面板管理脚本             │"
  echo "│   0. 退出脚本                                │"
  echo "│──────────────────────────────────────────────│"
  echo "│   1. 安装 Docker                             │"
  echo "│   2. 安装 Realm Web Manager                 │"
  echo "│   3. 卸载 Realm Web Manager                 │"
  echo "│──────────────────────────────────────────────│"
  echo "│   4. 启动面板                                │"
  echo "│   5. 停止面板                                │"
  echo "│   6. 重启面板                                │"
  echo "│──────────────────────────────────────────────│"
  echo "│   7. 修改Web路径                             │"
  echo "╚──────────────────────────────────────────────╝"
  echo
  echo "面板状态: $panel_state"
  echo "开机自启: $autostart"
  echo "Realm 状态: $realm_state"
  echo "当前路径: $path"
  echo
}

while true; do
  show_menu
  read -r -p "请输入你的选择 [0-7]: " selection
  case "$selection" in
    0) exit 0 ;;
    1) install_docker; pause ;;
    2) install_manager; pause ;;
    3) uninstall_manager; pause ;;
    4) start_manager; pause ;;
    5) stop_manager; pause ;;
    6) restart_manager; pause ;;
    7) change_path_menu; pause ;;
    *) echo "无效选择"; pause ;;
  esac
done
