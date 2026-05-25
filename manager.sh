#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/qqrrooty/realm-web-manager.git}"
MANAGER_URL="${MANAGER_URL:-https://raw.githubusercontent.com/qqrrooty/realm-web-manager/main/manager.sh}"
INSTALL_WEB_URL="${INSTALL_WEB_URL:-https://raw.githubusercontent.com/qqrrooty/realm-web-manager/main/install-web.sh}"
SCRIPT_PATH="${SCRIPT_PATH:-/root/realm}"
INSTALL_WEB_PATH="${INSTALL_WEB_PATH:-/root/realm-install-web.sh}"
APP_DIR="${APP_DIR:-/opt/realm-web-manager}"
CONTAINER_NAME="${CONTAINER_NAME:-realm-web-manager}"
PANEL_PORT="${PANEL_PORT:-18765}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
RESET="\033[0m"

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

realm_state_text() {
  if $SUDO docker exec "$CONTAINER_NAME" sh -c '
    for f in /proc/[0-9]*/cmdline; do
      cmd="$(tr "\000" " " < "$f" 2>/dev/null || true)"
      case "$cmd" in
        *"/data/realm/realm -c "*|*" realm -c "*|*"realm -c "*) exit 0 ;;
      esac
    done
    exit 1
  ' 2>/dev/null; then
    echo "运行中"
  elif $SUDO docker exec "$CONTAINER_NAME" test -x /data/realm/realm 2>/dev/null; then
    echo "未运行"
  else
    echo "未安装"
  fi
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

current_url() {
  local path ip
  path="$(current_path)"
  [ -n "$path" ] || path="/"
  ip="$(public_ip)"
  if [ -n "$ip" ]; then
    echo "http://${ip}:${PANEL_PORT}${path}"
  else
    echo "http://服务器IP:${PANEL_PORT}${path}"
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
  if [ -f install-web.sh ]; then
    $SUDO install -m 755 install-web.sh "$INSTALL_WEB_PATH"
  else
    if ! command -v curl >/dev/null 2>&1; then
      $SUDO apt-get update
      $SUDO apt-get install -y curl ca-certificates
    fi
    curl -fsSL "${INSTALL_WEB_URL}?t=$(date +%s)" | $SUDO tee "$INSTALL_WEB_PATH" >/dev/null
    $SUDO chmod +x "$INSTALL_WEB_PATH"
  fi
  if [ -n "$SUDO" ]; then
    $SUDO env REPO_URL="$REPO_URL" APP_DIR="$APP_DIR" SCRIPT_PATH="$SCRIPT_PATH" "$INSTALL_WEB_PATH"
  else
    REPO_URL="$REPO_URL" APP_DIR="$APP_DIR" SCRIPT_PATH="$SCRIPT_PATH" "$INSTALL_WEB_PATH"
  fi
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

change_login_info() {
  local username password confirm
  if [ "$($SUDO docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "missing")" != "running" ]; then
    echo "Web面板未运行，无法修改登录信息"
    return 1
  fi
  read -r -p "请输入新用户名: " username
  if ! printf '%s' "$username" | grep -Eq '^[a-zA-Z0-9_.-]{3,32}$'; then
    echo "用户名需为 3-32 位字母、数字、点、下划线或短横线"
    return 1
  fi
  read -r -s -p "请输入新密码: " password
  echo
  read -r -s -p "请再次输入新密码: " confirm
  echo
  if [ "$password" != "$confirm" ]; then
    echo "两次输入的密码不一致"
    return 1
  fi
  if [ "${#password}" -lt 8 ]; then
    echo "密码至少 8 位"
    return 1
  fi
  $SUDO docker exec \
    -e NEW_USERNAME="$username" \
    -e NEW_PASSWORD="$password" \
    "$CONTAINER_NAME" \
    node -e 'const fs=require("fs"); const crypto=require("crypto"); const username=process.env.NEW_USERNAME; const password=process.env.NEW_PASSWORD; const salt=crypto.randomBytes(16).toString("base64url"); const hash=crypto.pbkdf2Sync(password,salt,180000,32,"sha256").toString("base64url"); fs.writeFileSync("/data/users.json", JSON.stringify({users:[{username,salt,hash,createdAt:new Date().toISOString()}]}, null, 2));'
  echo "登录信息已修改"
}

update_script() {
  if ! command -v curl >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y curl ca-certificates
  fi
  local temp_file
  temp_file="$(mktemp)"
  curl -fsSL "${MANAGER_URL}?t=$(date +%s)" -o "$temp_file"
  $SUDO install -m 755 "$temp_file" "$SCRIPT_PATH"
  $SUDO ln -sf "$SCRIPT_PATH" /usr/local/bin/realm
  $SUDO ln -sf "$SCRIPT_PATH" /usr/local/bin/realm-web-manager
  rm -f "$temp_file"
  echo "SSH 管理脚本已更新"
  echo "脚本路径: $SCRIPT_PATH"
  echo "请重新输入 realm 打开新版脚本"
  exit 0
}

uninstall_script_only() {
  read -r -p "确认仅卸载 SSH 管理脚本？面板容器和数据不会删除。[y/N]: " ok
  case "$ok" in
    y|Y)
      $SUDO rm -f "$SCRIPT_PATH" /usr/local/bin/realm /usr/local/bin/realm-web-manager
      echo "SSH 管理脚本已卸载"
      echo "面板容器和数据没有删除"
      exit 0
      ;;
    *) echo "已取消" ;;
  esac
}

panel_state_text() {
  case "$1" in
    running) echo "运行中" ;;
    exited|created|dead) echo "已停止" ;;
    restarting) echo "重启中" ;;
    paused) echo "已暂停" ;;
    未安装) echo "未安装" ;;
    *) echo "未知" ;;
  esac
}

color_state() {
  case "$1" in
    运行中|是) printf "%b%s%b" "$GREEN" "$1" "$RESET" ;;
    未运行|已停止|运行失败|否|未安装) printf "%b%s%b" "$RED" "$1" "$RESET" ;;
    启动中|停止中|重启中|未知) printf "%b%s%b" "$YELLOW" "$1" "$RESET" ;;
    *) printf "%s" "$1" ;;
  esac
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
  local release panel_state realm_state current_access_url panel_state_display
  release="$(. /etc/os-release 2>/dev/null && echo "${ID:-unknown}" || echo "unknown")"
  panel_state="$($SUDO docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "未安装")"
  panel_state_display="$(panel_state_text "$panel_state")"
  current_access_url="$(current_url)"
  if [ "$panel_state" = "running" ]; then
    realm_state="$(realm_state_text)"
  else
    realm_state="未知"
  fi

  clear
  echo "The OS release is: $release"
  echo
  echo "╔──────────────────────────────────────────────╗"
  echo "│   Realm Web Manager 面板管理脚本             │"
  echo "│──────────────────────────────────────────────│"
  echo "│   1. 安装 Docker                             │"
  echo "│   2. 安装Web面板                             │"
  echo "│   3. 卸载Web面板                             │"
  echo "│──────────────────────────────────────────────│"
  echo "│   4. 启动Web面板                             │"
  echo "│   5. 停止Web面板                             │"
  echo "│   6. 重启Web面板                             │"
  echo "│──────────────────────────────────────────────│"
  echo "│   7. 修改Web路径                             │"
  echo "│   8. 修改登录信息                            │"
  echo "│──────────────────────────────────────────────│"
  echo "│   9. 更新脚本                                │"
  echo "│  10. 仅卸载脚本                              │"
  echo "│   0. 退出脚本                                │"
  echo "╚──────────────────────────────────────────────╝"
  echo
  printf "面板状态: %b\n" "$(color_state "$panel_state_display")"
  printf "Realm 状态: %b\n" "$(color_state "$realm_state")"
  echo "当前访问地址: $current_access_url"
  echo
}

while true; do
  show_menu
  read -r -p "请输入你的选择 [0-10]: " selection
  case "$selection" in
    0) exit 0 ;;
    1) install_docker; pause ;;
    2) install_manager; pause ;;
    3) uninstall_manager; pause ;;
    4) start_manager; pause ;;
    5) stop_manager; pause ;;
    6) restart_manager; pause ;;
    7) change_path_menu; pause ;;
    8) change_login_info; pause ;;
    9) update_script; pause ;;
    10) uninstall_script_only; pause ;;
    *) echo "无效选择"; pause ;;
  esac
done
