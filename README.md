# Realm Web Manager

Realm Web Manager 是 [zhboner/realm](https://github.com/zhboner/realm) 的 Docker Web 管理面板。

## 功能

- 首次打开页面初始化管理员账号
- 登录后管理 Realm 转发规则
- 安装/更新 Realm
- 启动、停止、重启 Realm
- 设置每日定时重启
- 支持 Nginx / Caddy 反代
- Docker Compose 部署

## 一键安装

用户安装时执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/qqrrooty/realm-web-manager/main/install.sh)
```

安装完成后，面板会监听：

```text
http://服务器IP:18765
```

首次打开会要求设置管理员用户名和密码。

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

面板默认监听 `0.0.0.0:18765`，可以直接用 `http://服务器IP:18765` 访问。

## 数据位置

Docker 数据卷保存：

- `/data/users.json`：管理员账号哈希
- `/data/config.toml`：Realm 配置
- `/data/realm/realm`：Realm 二进制
- `/data/realm_web_manager.log`：面板日志
- `/data/restart-schedule.json`：定时重启配置

## 安全提醒

- 不要上传 `.env`
- 不要上传 `/data/users.json`
- 直接用 IP + 端口访问时，请设置强密码
- 更高安全要求建议使用 HTTPS 反代访问

## 发布到 GitHub 前

如果要直接使用示例 Nginx 配置，请把 [nginx.realm-web-manager.conf](./nginx.realm-web-manager.conf) 里的 `realm.example.com` 改成你的域名。

建议上传这些文件：

- `.gitignore`
- `.env.example`
- `Dockerfile`
- `docker-compose.yml`
- `install.sh`
- `nginx.realm-web-manager.conf`
- `package.json`
- `README.md`
- `server.js`
- `public/`
