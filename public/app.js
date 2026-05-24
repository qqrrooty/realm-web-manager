const state = {
  endpoints: [],
  needsSetup: false
};

const $ = (selector) => document.querySelector(selector);

function toast(message, type = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.style.background = type === "error" ? "#c62828" : type === "ok" ? "#2e7d32" : "#263238";
  el.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body !== "string") {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败: ${res.status}`);
  return data;
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  $("#loginTitle").textContent = state.needsSetup ? "初始化管理员账号" : "Realm Web Manager";
  $("#loginHint").textContent = state.needsSetup ? "首次打开需要设置登录账号和密码" : "登录后进入管理面板";
  $("#confirmPasswordLabel").classList.toggle("hidden", !state.needsSetup);
  $("#loginSubmitBtn").textContent = state.needsSetup ? "创建账号" : "登录";
  $("#passwordInput").autocomplete = state.needsSetup ? "new-password" : "current-password";
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

function parseListen(listen) {
  const value = String(listen || "").trim();
  if (value.startsWith("0.0.0.0:")) return { mode: "ipv4", port: value.split(":").pop(), custom: "" };
  if (value.startsWith("[::]:")) return { mode: "ipv6", port: value.split(":").pop(), custom: "" };
  const portMatch = value.match(/:(\d+)$/);
  return { mode: "custom", port: portMatch ? portMatch[1] : "", custom: value };
}

function updateListenFields() {
  const mode = $("#listenMode").value;
  const port = $("#listenPort").value.trim();
  const customMode = mode === "custom";
  $("#listenPresetFields").classList.toggle("hidden", customMode);
  $("#listenCustomLabel").classList.toggle("hidden", !customMode);

  let listen = "";
  if (customMode) {
    listen = $("#listenCustom").value.trim();
  } else if (port) {
    listen = mode === "ipv4" ? `0.0.0.0:${port}` : `[::]:${port}`;
  }
  $("#listen").value = listen;
  $("#listenPreview").value = listen;
}

function resetForm() {
  $("#ruleId").value = "";
  $("#formTitle").textContent = "添加转发规则";
  $("#remark").value = "";
  $("#listenMode").value = "ipv6";
  $("#listenPort").value = "";
  $("#listenCustom").value = "";
  $("#remote").value = "";
  $("#extraRemotes").value = "";
  $("#balance").value = "";
  $("#through").value = "";
  $("#interfaceName").value = "";
  updateListenFields();
}

function fillForm(rule) {
  $("#ruleId").value = rule.id;
  $("#formTitle").textContent = `编辑规则 #${rule.id}`;
  $("#remark").value = rule.remark || "";
  const parsedListen = parseListen(rule.listen || "");
  $("#listenMode").value = parsedListen.mode;
  $("#listenPort").value = parsedListen.port;
  $("#listenCustom").value = parsedListen.custom;
  $("#listen").value = rule.listen || "";
  $("#remote").value = rule.remote || "";
  $("#extraRemotes").value = (rule.extraRemotes || []).join("\n");
  $("#balance").value = rule.balance || "";
  $("#through").value = rule.through || "";
  $("#interfaceName").value = rule.interface || "";
  updateListenFields();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderRules() {
  const box = $("#rulesList");
  $("#ruleCount").textContent = `${state.endpoints.length} 条`;
  if (!state.endpoints.length) {
    box.innerHTML = '<p class="empty">还没有转发规则。</p>';
    return;
  }
  box.innerHTML = state.endpoints
    .map(
      (rule) => `
      <article class="rule">
        <div class="rule-head">
          <div class="rule-title">#${rule.id} ${escapeHtml(rule.remark || "未命名规则")}</div>
          <div class="rule-actions">
            <button data-edit="${rule.id}">编辑</button>
            <button data-delete="${rule.id}">删除</button>
          </div>
        </div>
        <div class="pair"><span>listen</span><code>${escapeHtml(rule.listen || "-")}</code></div>
        <div class="pair"><span>remote</span><code>${escapeHtml(rule.remote || "-")}</code></div>
        ${
          rule.extraRemotes && rule.extraRemotes.length
            ? `<div class="pair"><span>备用</span><code>${escapeHtml(rule.extraRemotes.join(", "))}</code></div>`
            : ""
        }
        ${rule.balance ? `<div class="pair"><span>balance</span><code>${escapeHtml(rule.balance)}</code></div>` : ""}
        ${rule.through ? `<div class="pair"><span>through</span><code>${escapeHtml(rule.through)}</code></div>` : ""}
        ${rule.interface ? `<div class="pair"><span>interface</span><code>${escapeHtml(rule.interface)}</code></div>` : ""}
      </article>`
    )
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function setStateText(el, text, className) {
  el.textContent = text;
  el.className = className || "";
}

async function checkSession() {
  const data = await api("/api/session");
  state.needsSetup = Boolean(data.needsSetup);
  if (data.authenticated) {
    showApp();
    await loadStatus();
    await loadConfig();
  } else {
    showLogin();
  }
}

async function loadStatus() {
  const data = await api("/api/status");
  state.endpoints = data.endpoints || [];
  const active = data.status?.active || "unknown";
  const installed = Boolean(data.status?.installed);
  setStateText($("#serviceState"), active, active === "active" ? "state-ok" : "state-bad");
  setStateText($("#installState"), installed ? "已安装" : "未安装", installed ? "state-ok" : "state-warn");
  $("#configPath").textContent = data.configFile || "-";
  $("#logsOutput").textContent = (data.logs || []).join("\n") || "暂无日志";
  $("#cronList").textContent = (data.cronJobs || []).join("\n") || "暂无定时重启任务";
  renderRules();
}

async function loadConfig() {
  const data = await api("/api/config");
  $("#configContent").textContent = data.content || "";
}

async function saveRule(event) {
  event.preventDefault();
  updateListenFields();
  const id = $("#ruleId").value;
  const body = {
    remark: $("#remark").value,
    listen: $("#listen").value,
    remote: $("#remote").value,
    extraRemotes: $("#extraRemotes").value,
    balance: $("#balance").value,
    through: $("#through").value,
    interface: $("#interfaceName").value
  };
  await api(id ? `/api/endpoints/${id}` : "/api/endpoints", {
    method: id ? "PUT" : "POST",
    body
  });
  toast("规则已保存，Realm 已尝试重启", "ok");
  resetForm();
  await loadStatus();
  await loadConfig();
}

async function deleteRule(id) {
  if (!confirm(`确认删除规则 #${id}？`)) return;
  await api(`/api/endpoints/${id}`, { method: "DELETE" });
  toast("规则已删除", "ok");
  await loadStatus();
  await loadConfig();
}

async function serviceAction(action) {
  if (action === "install") {
    await api("/api/install", { method: "POST" });
    toast("安装/更新完成", "ok");
  } else {
    await api("/api/service", { method: "POST", body: { action } });
    toast(`服务已${action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}`, "ok");
  }
  await loadStatus();
}

async function exportRules() {
  const data = await api("/api/endpoints/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `realm-rules-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("规则备份已导出", "ok");
}

async function exportConfig() {
  const data = await api("/api/config");
  const blob = new Blob([data.content || ""], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `realm-config-${date}.toml`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("配置文件已导出", "ok");
}

async function importConfig(file) {
  if (!file) return;
  const content = await file.text();
  if (!content.trim()) throw new Error("配置文件为空");
  if (!confirm("确认导入完整配置文件？当前 config.toml 会被覆盖。")) return;
  await api("/api/config", { method: "PUT", body: { content } });
  toast("配置文件已导入", "ok");
  await loadStatus();
  await loadConfig();
}

async function importRules(file) {
  if (!file) return;
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效 JSON");
  }
  const count = Array.isArray(data.endpoints) ? data.endpoints.length : 0;
  if (!count) throw new Error("备份文件里没有规则");
  if (!confirm(`确认导入 ${count} 条规则？当前规则会被覆盖。`)) return;
  await api("/api/endpoints/import", { method: "POST", body: data });
  toast(`已导入 ${count} 条规则`, "ok");
  resetForm();
  await loadStatus();
  await loadConfig();
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const username = $("#usernameInput").value.trim();
      const password = $("#passwordInput").value;
      const creating = state.needsSetup;
      if (state.needsSetup) {
        const confirmPassword = $("#confirmPasswordInput").value;
        if (password !== confirmPassword) throw new Error("两次输入的密码不一致");
        await api("/api/setup", { method: "POST", body: { username, password } });
        state.needsSetup = false;
      } else {
        await api("/api/login", { method: "POST", body: { username, password } });
      }
      $("#usernameInput").value = "";
      $("#passwordInput").value = "";
      $("#confirmPasswordInput").value = "";
      showApp();
      await loadStatus();
      await loadConfig();
      toast(creating ? "账号已创建" : "登录成功", "ok");
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });
  $("#refreshBtn").addEventListener("click", async () => {
    try {
      await loadStatus();
      await loadConfig();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#refreshConfigBtn").addEventListener("click", () => loadConfig().catch((error) => toast(error.message, "error")));
  $("#resetFormBtn").addEventListener("click", resetForm);
  $("#listenMode").addEventListener("change", updateListenFields);
  $("#listenPort").addEventListener("input", updateListenFields);
  $("#listenCustom").addEventListener("input", updateListenFields);
  $("#exportRulesBtn").addEventListener("click", () => exportRules().catch((error) => toast(error.message, "error")));
  $("#importRulesBtn").addEventListener("click", () => $("#importRulesFile").click());
  $("#importRulesFile").addEventListener("change", async (event) => {
    try {
      await importRules(event.target.files[0]);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      event.target.value = "";
    }
  });
  $("#exportConfigBtn").addEventListener("click", () => exportConfig().catch((error) => toast(error.message, "error")));
  $("#importConfigBtn").addEventListener("click", () => $("#importConfigFile").click());
  $("#importConfigFile").addEventListener("change", async (event) => {
    try {
      await importConfig(event.target.files[0]);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      event.target.value = "";
    }
  });
  $("#ruleForm").addEventListener("submit", (event) => saveRule(event).catch((error) => toast(error.message, "error")));
  document.querySelector(".actions").addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (!action) return;
    serviceAction(action).catch((error) => toast(error.message, "error"));
  });
  $("#rulesList").addEventListener("click", (event) => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    if (editId) {
      const rule = state.endpoints.find((item) => String(item.id) === String(editId));
      if (rule) fillForm(rule);
    }
    if (deleteId) deleteRule(deleteId).catch((error) => toast(error.message, "error"));
  });
  $("#setCronBtn").addEventListener("click", async () => {
    try {
      await api("/api/cron", { method: "POST", body: { action: "set", hour: $("#cronHour").value } });
      toast("定时重启已设置", "ok");
      await loadStatus();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#clearCronBtn").addEventListener("click", async () => {
    try {
      await api("/api/cron", { method: "POST", body: { action: "clear" } });
      toast("定时任务已清除", "ok");
      await loadStatus();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

bindEvents();
updateListenFields();
checkSession().catch((error) => toast(error.message, "error"));
