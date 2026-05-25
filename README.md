# Realm Web Manager

Realm Web Manager 是 [zhboner/realm](https://github.com/zhboner/realm) 的 Docker Web 管理面板。

## 功能

- 首次打开页面初始化管理员账号
- 登录后管理 Realm 转发规则
- 安装/更新 Realm
- 启动、停止、重启 Realm
- 默认随机网页路径，避免直接扫 IP + 端口进入登录页
- SSH 管理脚本查看和修改当前 Web 路径
- SSH 管理脚本支持安装 Docker、安装/卸载面板、启动/停止/重启面板、修改 Web 路径
- 设置每日定时重启
- 支持 Nginx / Caddy 反代
- Docker Compose 部署

## SSH 管理脚本

先安装 SSH 管理脚本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/qqrrooty/realm-web-manager/main/install.sh)
```

然后在 SSH 中输入：

```bash
realm
```

管理脚本本体安装在：

```text
/root/realm
```

面板安装脚本安装在：

```text
/root/realm-install-web.sh
```

`/usr/local/bin/realm` 和 `/usr/local/bin/realm-web-manager` 是命令入口。

进入脚本后，选择 `2. 安装Web面板` 来安装 Realm Web Manager。

脚本菜单包含：

```text
1. 安装 Docker
2. 安装Web面板
3. 卸载Web面板
4. 启动Web面板
5. 停止Web面板
6. 重启Web面板
7. 修改Web路径
8. 更新脚本
9. 仅卸载脚本
0. 退出脚本
```

脚本底部会显示当前 Web 路径和访问地址。修改 Web 路径时可以选择随机路径或自定义路径。

首次打开面板页面会要求设置管理员用户名和密码。

## 手动安装

```bash
git clone https://github.com/qqrrooty/realm-web-manager.git
cd realm-web-manager
cp .env.example .env
```

编辑 `.env`，把 `REALM_SESSION_SECRET` 改成随机长字符串，然后启动：

```bash
docker compose up -d --build
```

## 防火墙

如果服务器开启了防火墙，请放行面板端口：

```bash
ufw allow 18765/tcp
```

## 可选：Nginx 反代

如果你想用域名访问，可以参考 [nginx.realm-web-manager.conf](./nginx.realm-web-manager.conf)：

```nginx
server {
  listen 80;
  server_name realm.example.com;

  location / {
    proxy_pass http://127.0.0.1:18765;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

如果使用反代，也建议配 HTTPS。

## Docker 说明

`docker-compose.yml` 使用 `network_mode: host`。这样 Realm 配置里的监听端口会直接监听在宿主机上，适合做端口转发管理。

面板默认监听 `0.0.0.0:18765`，访问地址由 SSH 管理脚本显示。
首次启动会自动生成 16 位随机访问路径，并保存到 Docker 数据卷的 `/data/web-path`。路径查看和修改都在 SSH 管理脚本里完成。

如果要手动指定初始路径，可以在 `.env` 中加入：

```env
WEB_BASE_PATH=/1234567890abcdef
```

路径只能使用 6-48 位字母、数字、下划线或短横线。

## 数据位置

Docker 数据卷保存：

- `/data/users.json`：管理员账号哈希
- `/data/config.toml`：Realm 配置
- `/data/realm/realm`：Realm 二进制
- `/data/realm_web_manager.log`：面板日志
- `/data/restart-schedule.json`：定时重启配置
- `/data/web-path`：面板随机访问路径

## 安全提醒

- 不要上传 `.env`
- 不要上传 `/data/users.json`
- 不要公开 `/data/web-path`
- 直接用 IP + 端口访问时，请保留随机路径并设置强密码
- 更高安全要求建议使用 HTTPS 反代访问

## 发布到 GitHub 前

如果要直接使用示例 Nginx 配置，请把 [nginx.realm-web-manager.conf](./nginx.realm-web-manager.conf) 里的 `realm.example.com` 改成你的域名。

建议上传这些文件：

- `.gitignore`
- `.env.example`
- `Dockerfile`
- `docker-compose.yml`
- `install.sh`
- `install-web.sh`
- `nginx.realm-web-manager.conf`
- `manager.sh`
- `package.json`
- `README.md`
- `server.js`
- `public/`
