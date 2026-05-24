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

function resetForm() {
  $("#ruleId").value = "";
  $("#formTitle").textContent = "添加转发规则";
  $("#remark").value = "";
  $("#listen").value = "";
  $("#remote").value = "";
  $("#extraRemotes").value = "";
  $("#balance").value = "";
  $("#through").value = "";
  $("#interfaceName").value = "";
}

function fillForm(rule) {
  $("#ruleId").value = rule.id;
  $("#formTitle").textContent = `编辑规则 #${rule.id}`;
  $("#remark").value = rule.remark || "";
  $("#listen").value = rule.listen || "";
  $("#remote").value = rule.remote || "";
  $("#extraRemotes").value = (rule.extraRemotes || []).join("\n");
  $("#balance").value = rule.balance || "";
  $("#through").value = rule.through || "";
  $("#interfaceName").value = rule.interface || "";
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

async function saveRule(event) {
  event.preventDefault();
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
}

async function deleteRule(id) {
  if (!confirm(`确认删除规则 #${id}？`)) return;
  await api(`/api/endpoints/${id}`, { method: "DELETE" });
  toast("规则已删除", "ok");
  await loadStatus();
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
      toast(creating ? "账号已创建" : "登录成功", "ok");
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });
  $("#refreshBtn").addEventListener("click", () => loadStatus().catch((error) => toast(error.message, "error")));
  $("#resetFormBtn").addEventListener("click", resetForm);
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
checkSession().catch((error) => toast(error.message, "error"));
