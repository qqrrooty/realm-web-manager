const crypto = require("crypto");
const http = require("http");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { exec, execFile, spawn } = require("child_process");

const VERSION = "1.1.0";
const PORT = Number(process.env.PORT || 18765);
const HOST = process.env.HOST || "0.0.0.0";
const RUNTIME = process.env.REALM_RUNTIME || (fsSync.existsSync("/.dockerenv") ? "docker" : "systemd");
const SESSION_SECRET = process.env.REALM_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const REALM_DIR = process.env.REALM_DIR || (RUNTIME === "docker" ? "/data/realm" : "/root/realm");
const REALM_BIN = process.env.REALM_BIN || path.join(REALM_DIR, "realm");
const CONFIG_FILE = process.env.REALM_CONFIG || (RUNTIME === "docker" ? "/data/config.toml" : path.join(REALM_DIR, "config.toml"));
const SERVICE_FILE = process.env.REALM_SERVICE_FILE || "/etc/systemd/system/realm.service";
const CRONTAB_FILE = process.env.REALM_CRONTAB || "/etc/crontab";
const CRON_STATE_FILE = process.env.REALM_CRON_STATE || "/data/restart-schedule.json";
const USERS_FILE = process.env.REALM_USERS_FILE || "/data/users.json";
const LOG_FILE = process.env.REALM_WEB_LOG || (RUNTIME === "docker" ? "/data/realm_web_manager.log" : "/var/log/realm_web_manager.log");
const PUBLIC_DIR = path.join(__dirname, "public");
const AUTO_START_REALM = process.env.AUTO_START_REALM !== "false";

let realmProcess = null;
let realmStartedAt = null;
let manualStop = false;
let restartTimer = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function runFile(command, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 120000, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: stdout || "",
        stderr: stderr || "",
        message: error ? error.message : ""
      });
    });
  });
}

function runShell(command, options = {}) {
  return new Promise((resolve) => {
    exec(command, { timeout: 180000, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: stdout || "",
        stderr: stderr || "",
        message: error ? error.message : ""
      });
    });
  });
}

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, line);
  } catch {
    // Logging must not break the management API.
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function signSession(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function createSessionCookie(username) {
  const payload = JSON.stringify({ iat: Date.now(), username });
  const encoded = Buffer.from(payload).toString("base64url");
  const value = `${encoded}.${signSession(encoded)}`;
  const secure = COOKIE_SECURE ? "; Secure" : "";
  return `realm_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`;
}

function isAuthenticated(req) {
  const value = parseCookies(req).realm_session;
  if (!value || !value.includes(".")) return false;
  const [payload, signature] = value.split(".");
  if (signature !== signSession(payload)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Boolean(data.username) && Date.now() - Number(data.iat) < 7 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  sendJson(res, 401, { ok: false, error: "请先登录" });
  return false;
}

function parseQuotedValue(line) {
  const match = line.match(/=\s*"([^"]*)"/);
  return match ? match[1] : "";
}

function parseArrayValue(line) {
  const match = line.match(/=\s*\[(.*)\]\s*$/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function parseConfig(content) {
  const lines = content.split(/\r?\n/);
  const endpoints = [];
  const endpointStartIndexes = [];

  lines.forEach((line, index) => {
    if (/^\s*\[\[endpoints\]\]\s*$/.test(line)) endpointStartIndexes.push(index);
  });

  for (let i = 0; i < endpointStartIndexes.length; i += 1) {
    const start = endpointStartIndexes[i];
    const end = i + 1 < endpointStartIndexes.length ? endpointStartIndexes[i + 1] : lines.length;
    const block = lines.slice(start, end);
    const endpoint = {
      id: i + 1,
      remark: "",
      listen: "",
      remote: "",
      extraRemotes: [],
      balance: "",
      through: "",
      interface: "",
      raw: block.join("\n").trim()
    };

    for (const line of block) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# 备注:")) endpoint.remark = trimmed.replace(/^# 备注:\s*/, "");
      if (trimmed.startsWith("# remark:")) endpoint.remark = trimmed.replace(/^# remark:\s*/, "");
      if (trimmed.startsWith("listen")) endpoint.listen = parseQuotedValue(trimmed);
      if (trimmed.startsWith("remote")) endpoint.remote = parseQuotedValue(trimmed);
      if (trimmed.startsWith("extra_remotes")) endpoint.extraRemotes = parseArrayValue(trimmed);
      if (trimmed.startsWith("balance")) endpoint.balance = parseQuotedValue(trimmed);
      if (trimmed.startsWith("through")) endpoint.through = parseQuotedValue(trimmed);
      if (trimmed.startsWith("interface")) endpoint.interface = parseQuotedValue(trimmed);
    }
    endpoints.push(endpoint);
  }

  const firstEndpoint = endpointStartIndexes[0] ?? lines.length;
  const header = lines.slice(0, firstEndpoint).join("\n").trimEnd();
  return { header, endpoints };
}

function escapeTomlString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function endpointToToml(endpoint) {
  const lines = ["", "[[endpoints]]"];
  if (endpoint.remark) lines.push(`# 备注: ${endpoint.remark.replace(/\r?\n/g, " ").trim()}`);
  lines.push(`listen = "${escapeTomlString(endpoint.listen)}"`);
  lines.push(`remote = "${escapeTomlString(endpoint.remote)}"`);
  if (Array.isArray(endpoint.extraRemotes) && endpoint.extraRemotes.length) {
    const values = endpoint.extraRemotes.map((item) => `"${escapeTomlString(item)}"`).join(", ");
    lines.push(`extra_remotes = [${values}]`);
  }
  if (endpoint.balance) lines.push(`balance = "${escapeTomlString(endpoint.balance)}"`);
  if (endpoint.through) lines.push(`through = "${escapeTomlString(endpoint.through)}"`);
  if (endpoint.interface) lines.push(`interface = "${escapeTomlString(endpoint.interface)}"`);
  return lines.join("\n");
}

function buildConfig(header, endpoints) {
  const safeHeader = header && header.trim() ? header.trimEnd() : "[network]\nno_tcp = false\nuse_udp = true";
  return `${safeHeader}\n${endpoints.map(endpointToToml).join("\n")}\n`;
}

async function ensureBaseConfig() {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await fs.writeFile(CONFIG_FILE, "[network]\nno_tcp = false\nuse_udp = true\n", "utf8");
  }
}

async function readConfig() {
  await ensureBaseConfig();
  const content = await fs.readFile(CONFIG_FILE, "utf8");
  return parseConfig(content);
}

async function writeConfig(parsed) {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, buildConfig(parsed.header, parsed.endpoints), "utf8");
}

function validateEndpoint(data) {
  const listen = String(data.listen || "").trim();
  const remote = String(data.remote || "").trim();
  if (!listen || !remote) throw new Error("listen 和 remote 不能为空");
  if (!/^\[?[0-9a-zA-Z:.%-]+\]?:\d+$/.test(listen)) {
    throw new Error("listen 格式应类似 0.0.0.0:8080 或 [::]:8080");
  }
  if (!/^.+:\d+$/.test(remote)) throw new Error("remote 格式应类似 example.com:443 或 1.2.3.4:443");
  assertAddressPort(listen, "listen");
  assertAddressPort(remote, "remote");
  const extraRemotes = Array.isArray(data.extraRemotes)
    ? data.extraRemotes
    : String(data.extraRemotes || "")
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
  extraRemotes.forEach((item) => assertAddressPort(item, "extra_remotes"));
  return {
    remark: String(data.remark || "").trim(),
    listen,
    remote,
    extraRemotes,
    balance: String(data.balance || "").trim(),
    through: String(data.through || "").trim(),
    interface: String(data.interface || "").trim()
  };
}

function assertAddressPort(value, name) {
  const match = String(value).trim().match(/:(\d+)$/);
  if (!match) throw new Error(`${name} 缺少端口`);
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 端口必须在 1-65535 之间`);
  }
}

function getPort(value) {
  const match = String(value || "").trim().match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function assertUniqueListenPorts(endpoints, ignoreIndex = -1) {
  const used = new Map();
  endpoints.forEach((endpoint, index) => {
    if (index === ignoreIndex) return;
    const port = getPort(endpoint.listen);
    if (!port) return;
    if (used.has(port)) throw new Error(`本地监听端口 ${port} 已被规则 #${used.get(port) + 1} 使用`);
    used.set(port, index);
  });
}

async function systemdStatus() {
  const active = await runFile("systemctl", ["is-active", "realm"]);
  const enabled = await runFile("systemctl", ["is-enabled", "realm"]);
  const version = await runFile(REALM_BIN, ["--version"]);
  return {
    active: active.stdout.trim() || (active.ok ? "active" : "inactive"),
    enabled: enabled.stdout.trim() || "unknown",
    realmVersion: (version.stdout || version.stderr).trim(),
    installed: fsSync.existsSync(REALM_BIN) && fsSync.existsSync(SERVICE_FILE),
    runtime: RUNTIME
  };
}

async function dockerStatus() {
  const version = await runFile(REALM_BIN, ["--version"]);
  return {
    active: realmProcess && !realmProcess.killed ? "active" : "inactive",
    enabled: AUTO_START_REALM ? "autostart" : "manual",
    realmVersion: (version.stdout || version.stderr).trim(),
    installed: fsSync.existsSync(REALM_BIN),
    runtime: RUNTIME,
    pid: realmProcess?.pid || null,
    startedAt: realmStartedAt
  };
}

async function serviceStatus() {
  return RUNTIME === "docker" ? dockerStatus() : systemdStatus();
}

async function ensureServiceFile() {
  const body = `[Unit]
Description=Realm Proxy Service
After=network.target

[Service]
Type=simple
ExecStart=${REALM_BIN} -c ${CONFIG_FILE}
Restart=always
User=root

[Install]
WantedBy=multi-user.target
`;
  await fs.writeFile(SERVICE_FILE, body, "utf8");
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function installRealm() {
  await fs.mkdir(REALM_DIR, { recursive: true });
  const script = [
    "set -e",
    `cd ${quoteShell(REALM_DIR)}`,
    "if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y curl; fi",
    "if ! command -v tar >/dev/null 2>&1; then apt-get update && apt-get install -y tar; fi",
    "LATEST=$(curl -fsSL https://api.github.com/repos/zhboner/realm/releases/latest 2>/dev/null | sed -n 's/.*\"tag_name\": *\"v\\([0-9.]*\\)\".*/\\1/p' | head -n1 || true)",
    "if [ -z \"$LATEST\" ]; then LATEST=2.7.0; fi",
    "ARCH=$(uname -m)",
    "case \"$ARCH\" in x86_64|amd64) ASSET=realm-x86_64-unknown-linux-gnu.tar.gz ;; aarch64|arm64) ASSET=realm-aarch64-unknown-linux-gnu.tar.gz ;; *) echo \"Unsupported arch: $ARCH\" >&2; exit 1 ;; esac",
    "curl -fL --retry 3 -o realm.tar.gz \"https://github.com/zhboner/realm/releases/download/v${LATEST}/${ASSET}\"",
    "tar -xzf realm.tar.gz",
    "chmod +x realm",
    "rm -f realm.tar.gz"
  ].join("\n");
  const result = await runShell(script);
  if (!result.ok) throw new Error(result.stderr || result.message || "Realm 下载失败");
  await ensureBaseConfig();
  if (RUNTIME === "systemd") {
    await ensureServiceFile();
    await runFile("systemctl", ["daemon-reload"]);
  }
  await log("安装或更新 Realm");
  return result;
}

function startDockerRealm() {
  if (realmProcess && !realmProcess.killed) return { ok: true, stdout: "Realm 已在运行" };
  if (!fsSync.existsSync(REALM_BIN)) throw new Error(`找不到 Realm: ${REALM_BIN}`);
  manualStop = false;
  realmProcess = spawn(REALM_BIN, ["-c", CONFIG_FILE], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  realmStartedAt = new Date().toISOString();
  realmProcess.stdout.on("data", (chunk) => log(`[realm] ${chunk.toString().trim()}`));
  realmProcess.stderr.on("data", (chunk) => log(`[realm] ${chunk.toString().trim()}`));
  realmProcess.on("exit", (code) => {
    const stoppedManually = manualStop;
    realmProcess = null;
    realmStartedAt = null;
    log(`Realm 退出，code=${code}`);
    if (!stoppedManually && AUTO_START_REALM) {
      setTimeout(() => {
        startDockerRealm();
      }, 2000);
    }
  });
  log(`Docker 模式启动 Realm，pid=${realmProcess.pid}`);
  return { ok: true, stdout: `Realm 已启动，pid=${realmProcess.pid}` };
}

function stopDockerRealm() {
  manualStop = true;
  if (!realmProcess || realmProcess.killed) return { ok: true, stdout: "Realm 未运行" };
  realmProcess.kill("SIGTERM");
  return { ok: true, stdout: "Realm 已发送停止信号" };
}

async function controlDockerService(action) {
  if (action === "start") return startDockerRealm();
  if (action === "stop") return stopDockerRealm();
  if (action === "restart") {
    stopDockerRealm();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return startDockerRealm();
  }
  throw new Error("未知服务操作");
}

async function controlSystemdService(action) {
  const map = {
    start: [["unmask", "realm.service"], ["daemon-reload"], ["enable", "--now", "realm.service"]],
    stop: [["stop", "realm.service"]],
    restart: [["unmask", "realm.service"], ["daemon-reload"], ["restart", "realm.service"], ["enable", "realm.service"]]
  };
  if (!map[action]) throw new Error("未知服务操作");
  let last = { ok: true, stdout: "", stderr: "" };
  for (const args of map[action]) {
    last = await runFile("systemctl", args);
    if (!last.ok) throw new Error(last.stderr || last.message || `服务操作失败: ${action}`);
  }
  return last;
}

async function controlService(action) {
  const result = RUNTIME === "docker" ? await controlDockerService(action) : await controlSystemdService(action);
  await log(`服务操作: ${action}`);
  return result;
}

async function readCronJobs() {
  if (RUNTIME === "docker") {
    try {
      const data = JSON.parse(await fs.readFile(CRON_STATE_FILE, "utf8"));
      return data.enabled ? [`每日 ${data.hour}:00 重启 Realm`] : [];
    } catch {
      return [];
    }
  }
  try {
    const content = await fs.readFile(CRONTAB_FILE, "utf8");
    return content.split(/\r?\n/).filter((line) => line.includes("systemctl restart realm"));
  } catch {
    return [];
  }
}

function scheduleDockerRestart(hour) {
  clearTimeout(restartTimer);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  restartTimer = setTimeout(async () => {
    await controlDockerService("restart").catch((error) => log(`定时重启失败: ${error.message}`));
    scheduleDockerRestart(hour);
  }, next.getTime() - now.getTime());
}

async function setDailyRestart(hour) {
  const safeHour = Number(hour);
  if (!Number.isInteger(safeHour) || safeHour < 0 || safeHour > 23) throw new Error("小时必须是 0-23");
  if (RUNTIME === "docker") {
    await fs.mkdir(path.dirname(CRON_STATE_FILE), { recursive: true });
    await fs.writeFile(CRON_STATE_FILE, JSON.stringify({ enabled: true, hour: safeHour }, null, 2), "utf8");
    scheduleDockerRestart(safeHour);
  } else {
    let content = "";
    try {
      content = await fs.readFile(CRONTAB_FILE, "utf8");
    } catch {
      content = "";
    }
    const lines = content.split(/\r?\n/).filter((line) => !line.includes("systemctl restart realm"));
    lines.push(`0 ${safeHour} * * * root /usr/bin/systemctl restart realm`);
    await fs.writeFile(CRONTAB_FILE, `${lines.filter(Boolean).join("\n")}\n`, "utf8");
  }
  await log(`设置每日 ${safeHour}:00 重启`);
}

async function clearRestartCron() {
  if (RUNTIME === "docker") {
    clearTimeout(restartTimer);
    restartTimer = null;
    await fs.writeFile(CRON_STATE_FILE, JSON.stringify({ enabled: false }, null, 2), "utf8").catch(() => {});
  } else {
    let content = "";
    try {
      content = await fs.readFile(CRONTAB_FILE, "utf8");
    } catch {
      return;
    }
    const lines = content.split(/\r?\n/).filter((line) => !line.includes("systemctl restart realm"));
    await fs.writeFile(CRONTAB_FILE, `${lines.filter(Boolean).join("\n")}\n`, "utf8");
  }
  await log("清除 Realm 定时重启任务");
}

async function restoreDockerSchedule() {
  if (RUNTIME !== "docker") return;
  try {
    const data = JSON.parse(await fs.readFile(CRON_STATE_FILE, "utf8"));
    if (data.enabled) scheduleDockerRestart(Number(data.hour));
  } catch {
    // No schedule yet.
  }
}

async function readUsers() {
  try {
    return JSON.parse(await fs.readFile(USERS_FILE, "utf8"));
  } catch {
    return { users: [] };
  }
}

async function writeUsers(data) {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.pbkdf2Sync(password, salt, 180000, 32, "sha256").toString("base64url");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const current = hashPassword(password, user.salt).hash;
  const a = Buffer.from(current);
  const b = Buffer.from(user.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleAuthApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/session") {
    const users = await readUsers();
    sendJson(res, 200, {
      ok: true,
      authenticated: isAuthenticated(req),
      needsSetup: users.users.length === 0,
      loginRequired: true
    });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/setup") {
    const users = await readUsers();
    if (users.users.length > 0) return sendJson(res, 409, { ok: false, error: "管理员账号已经初始化" });
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("用户名需为 3-32 位字母、数字、点、下划线或短横线");
    if (password.length < 8) throw new Error("密码至少 8 位");
    const passwordData = hashPassword(password);
    await writeUsers({
      users: [
        {
          username,
          salt: passwordData.salt,
          hash: passwordData.hash,
          createdAt: new Date().toISOString()
        }
      ]
    });
    await log(`初始化管理员账号: ${username}`);
    sendJson(res, 200, { ok: true }, { "set-cookie": createSessionCookie(username) });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/login") {
    const body = await readBody(req);
    const users = await readUsers();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const user = users.users.find((item) => item.username === username);
    if (user && verifyPassword(password, user)) {
      sendJson(res, 200, { ok: true }, { "set-cookie": createSessionCookie(username) });
      return true;
    }
    await log("登录失败");
    sendJson(res, 401, { ok: false, error: "用户名或密码错误" });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/logout") {
    sendJson(res, 200, { ok: true }, { "set-cookie": "realm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    return true;
  }
  return null;
}

async function handleApi(req, res, pathname) {
  try {
    const authHandled = await handleAuthApi(req, res, pathname);
    if (authHandled !== null) return;
    if (!requireAuth(req, res)) return;

    if (req.method === "GET" && pathname === "/api/status") {
      const [status, parsed, cronJobs, logs] = await Promise.all([
        serviceStatus(),
        readConfig(),
        readCronJobs(),
        fs.readFile(LOG_FILE, "utf8").catch(() => "")
      ]);
      return sendJson(res, 200, {
        ok: true,
        version: VERSION,
        configFile: CONFIG_FILE,
        status,
        endpoints: parsed.endpoints,
        cronJobs,
        logs: logs.split(/\r?\n/).filter(Boolean).slice(-80)
      });
    }

    if (req.method === "POST" && pathname === "/api/install") {
      const result = await installRealm();
      if (RUNTIME === "docker") await controlService("restart");
      return sendJson(res, 200, { ok: true, output: result.stdout || result.stderr });
    }

    if (req.method === "POST" && pathname === "/api/service") {
      const body = await readBody(req);
      const result = await controlService(body.action);
      return sendJson(res, 200, { ok: true, output: result.stdout || result.stderr });
    }

    if (req.method === "POST" && pathname === "/api/endpoints") {
      const body = await readBody(req);
      const parsed = await readConfig();
      const endpoint = validateEndpoint(body);
      assertUniqueListenPorts([...parsed.endpoints, endpoint]);
      parsed.endpoints.push(endpoint);
      await writeConfig(parsed);
      await controlService("restart").catch((error) => log(`重启失败: ${error.message}`));
      await log(`添加规则: ${body.listen} -> ${body.remote}`);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/endpoints/export") {
      const parsed = await readConfig();
      return sendJson(res, 200, {
        ok: true,
        exportedAt: new Date().toISOString(),
        version: VERSION,
        endpoints: parsed.endpoints.map(({ id, raw, ...endpoint }) => endpoint)
      });
    }

    if (req.method === "POST" && pathname === "/api/endpoints/import") {
      const body = await readBody(req);
      const endpoints = Array.isArray(body.endpoints) ? body.endpoints : [];
      if (!endpoints.length) throw new Error("备份文件里没有可导入的规则");
      const parsed = await readConfig();
      parsed.endpoints = endpoints.map(validateEndpoint);
      assertUniqueListenPorts(parsed.endpoints);
      await writeConfig(parsed);
      await controlService("restart").catch((error) => log(`重启失败: ${error.message}`));
      await log(`导入规则备份，共 ${parsed.endpoints.length} 条`);
      return sendJson(res, 200, { ok: true, count: parsed.endpoints.length });
    }

    const endpointMatch = pathname.match(/^\/api\/endpoints\/(\d+)$/);
    if (endpointMatch && req.method === "PUT") {
      const id = Number(endpointMatch[1]);
      const body = await readBody(req);
      const parsed = await readConfig();
      if (!parsed.endpoints[id - 1]) throw new Error("规则不存在");
      const endpoint = validateEndpoint(body);
      const nextEndpoints = [...parsed.endpoints];
      nextEndpoints[id - 1] = endpoint;
      assertUniqueListenPorts(nextEndpoints);
      parsed.endpoints = nextEndpoints;
      await writeConfig(parsed);
      await controlService("restart").catch((error) => log(`重启失败: ${error.message}`));
      await log(`更新规则 #${id}`);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/endpoints/bulk-delete") {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids)
        ? [...new Set(body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
        : [];
      if (!ids.length) throw new Error("请选择要删除的规则");
      const parsed = await readConfig();
      const idSet = new Set(ids);
      const before = parsed.endpoints.length;
      parsed.endpoints = parsed.endpoints.filter((_, index) => !idSet.has(index + 1));
      const deleted = before - parsed.endpoints.length;
      if (!deleted) throw new Error("没有匹配到可删除的规则");
      await writeConfig(parsed);
      await controlService("restart").catch((error) => log(`重启失败: ${error.message}`));
      await log(`批量删除规则，共 ${deleted} 条`);
      return sendJson(res, 200, { ok: true, deleted });
    }

    if (endpointMatch && req.method === "DELETE") {
      const id = Number(endpointMatch[1]);
      const parsed = await readConfig();
      if (!parsed.endpoints[id - 1]) throw new Error("规则不存在");
      parsed.endpoints.splice(id - 1, 1);
      await writeConfig(parsed);
      await controlService("restart").catch((error) => log(`重启失败: ${error.message}`));
      await log(`删除规则 #${id}`);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/cron") {
      const body = await readBody(req);
      if (body.action === "set") await setDailyRestart(body.hour);
      else if (body.action === "clear") await clearRestartCron();
      else throw new Error("未知定时任务操作");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/config") {
      await ensureBaseConfig();
      const content = await fs.readFile(CONFIG_FILE, "utf8");
      return sendJson(res, 200, { ok: true, configFile: CONFIG_FILE, content });
    }

    if (req.method === "PUT" && pathname === "/api/config") {
      const body = await readBody(req);
      const content = String(body.content || "").trim();
      if (!content.includes("[network]") && !content.includes("[[endpoints]]")) {
        throw new Error("配置内容不像有效的 Realm config.toml");
      }
      await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
      await fs.writeFile(CONFIG_FILE, `${content}\n`, "utf8");
      await controlService("restart").catch((error) => log(`重启失败: ${error.message}`));
      await log("导入完整配置文件");
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { ok: false, error: "接口不存在" });
  } catch (error) {
    await log(`错误: ${error.message}`);
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, requested.replace(/^\/+/, ""));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return sendText(res, 403, "Forbidden");
  try {
    const data = await fs.readFile(filePath);
    sendText(res, 200, data, MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
  return serveStatic(req, res, url.pathname);
});

async function boot() {
  await ensureBaseConfig();
  await restoreDockerSchedule();
  if (RUNTIME === "docker" && AUTO_START_REALM && fsSync.existsSync(REALM_BIN)) {
    startDockerRealm();
  }
  server.listen(PORT, HOST, () => {
    console.log(`Realm Web Manager listening on http://${HOST}:${PORT}`);
    console.log(`Runtime: ${RUNTIME}`);
    if (RUNTIME === "systemd" && typeof process.getuid === "function" && process.getuid() !== 0) {
      console.log("Warning: not running as root. Install, service control, and crontab management may fail.");
    }
  });
}

boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
