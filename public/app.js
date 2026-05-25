const state = {
  endpoints: [],
  needsSetup: false,
  selectedRuleIds: new Set(),
  rulesPage: 1,
  rulesPageSize: 8
};

const $ = (selector) => document.querySelector(selector);
const API_BASE_PATH = `/${location.pathname.split("/").filter(Boolean)[0] || ""}`.replace(/\/$/, "");
const savedTheme = localStorage.getItem("realmTheme") || "light";
document.documentElement.dataset.theme = savedTheme;
const savedSidebarValue = localStorage.getItem("realmSidebarCollapsed");
const savedSidebarCollapsed = savedSidebarValue === null ? window.matchMedia("(max-width: 720px)").matches : savedSidebarValue === "true";

function toast(message, type = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.style.background = type === "error" ? "#d94d45" : type === "ok" ? "#3f8f78" : "#3f8f78";
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
  const res = await fetch(`${API_BASE_PATH}${path}`, { ...options, headers });
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

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("realmTheme", theme);
  if ($("#themeToggleBtn")) $("#themeToggleBtn .nav-text").textContent = theme === "dark" ? "浅色" : "暗色";
}

function setSidebarCollapsed(collapsed) {
  $("#appView").classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("realmSidebarCollapsed", String(collapsed));
  $("#sidebarToggleBtn").textContent = collapsed ? "›" : "‹";
}

function setAdvancedOptions(open) {
  $("#advancedOptions").classList.toggle("hidden", !open);
  $("#advancedToggleBtn").textContent = open ? "收起高级选项" : "高级选项";
}

function openRuleModal() {
  $("#ruleModal").classList.remove("hidden");
}

function closeRuleModal() {
  $("#ruleModal").classList.add("hidden");
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

function assertPortRange(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label}端口必须在 1-65535 之间`);
  }
}

function assertAddressPort(value, label) {
  const match = String(value || "").trim().match(/:(\d+)$/);
  if (!match) throw new Error(`${label}缺少端口`);
  assertPortRange(match[1], label);
}

function getAddressPort(value) {
  const match = String(value || "").trim().match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function assertUniqueListenPort(listen, currentId) {
  const port = getAddressPort(listen);
  const used = state.endpoints.find((rule) => rule.id !== Number(currentId || 0) && getAddressPort(rule.listen) === port);
  if (used) throw new Error(`本地端口 ${port} 已被规则 #${used.id} 使用`);
}

function resetForm() {
  $("#ruleId").value = "";
  $("#formTitle").textContent = "添加转发规则";
  document.querySelector('#ruleForm button[type="submit"]').textContent = "创建";
  $("#remark").value = "";
  $("#listenMode").value = "ipv6";
  $("#listenPort").value = "";
  $("#listenCustom").value = "";
  $("#remote").value = "";
  $("#extraRemotes").value = "";
  $("#balance").value = "";
  $("#through").value = "";
  $("#interfaceName").value = "";
  setAdvancedOptions(false);
  updateListenFields();
}

function fillForm(rule) {
  $("#ruleId").value = rule.id;
  $("#formTitle").textContent = `编辑规则 #${rule.id}`;
  document.querySelector('#ruleForm button[type="submit"]').textContent = "保存";
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
  setAdvancedOptions(Boolean((rule.extraRemotes || []).length || rule.balance || rule.through || rule.interface));
  updateListenFields();
  openRuleModal();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderRules() {
  const box = $("#rulesList");
  $("#ruleCount").textContent = `${state.endpoints.length} 条`;
  const totalPages = Math.max(1, Math.ceil(state.endpoints.length / state.rulesPageSize));
  state.rulesPage = Math.min(Math.max(1, state.rulesPage), totalPages);
  const start = (state.rulesPage - 1) * state.rulesPageSize;
  const pageRules = state.endpoints.slice(start, start + state.rulesPageSize);
  $("#rulesPageInfo").textContent = `${state.rulesPage} / ${totalPages}`;
  $("#prevRulesPageBtn").disabled = state.rulesPage <= 1;
  $("#nextRulesPageBtn").disabled = state.rulesPage >= totalPages;
  if (!state.endpoints.length) {
    box.innerHTML = '<p class="empty">还没有转发规则。</p>';
    return;
  }
  box.innerHTML = pageRules
    .map(
      (rule) => `
      <article class="rule">
        <div class="rule-head">
          <label class="rule-check">
            <input type="checkbox" data-select-rule="${rule.id}" ${state.selectedRuleIds.has(rule.id) ? "checked" : ""}>
            <button class="switch ${rule.enabled === false ? "" : "on"}" data-toggle="${rule.id}" data-enabled="${rule.enabled === false ? "true" : "false"}" aria-label="${rule.enabled === false ? "启动规则" : "关闭规则"}" type="button"></button>
            <span class="rule-title">#${rule.id}</span>
            <span class="status-pill ${rule.enabled === false ? "off" : "on"}">${rule.enabled === false ? "已关闭" : "运行中"}</span>
          </label>
          <div class="rule-actions">
            <button data-edit="${rule.id}">编辑</button>
            <button data-delete="${rule.id}">删除</button>
          </div>
        </div>
        <div class="rule-remark">${escapeHtml(rule.remark || "未命名规则")}</div>
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

function serviceStateText(value) {
  const stateText = {
    active: "运行中",
    inactive: "未运行",
    failed: "运行失败",
    activating: "启动中",
    deactivating: "停止中",
    unknown: "未知"
  };
  return stateText[value] || value || "未知";
}

function realmVersionText(value) {
  const match = String(value || "").match(/realm\s+v?(\d+(?:\.\d+){1,3})|v?(\d+(?:\.\d+){1,3})/i);
  const version = match && (match[1] || match[2]);
  return version ? `Realm ${version}` : "未知版本";
}

function menuStateText(value) {
  const map = {
    active: "运行中",
    inactive: "已停止",
    failed: "运行失败",
    activating: "启动中",
    deactivating: "停止中",
    unknown: "未知"
  };
  return map[value] || value || "未知";
}

function autoStartText(value) {
  const map = {
    enabled: "是",
    autostart: "是",
    disabled: "否",
    manual: "否",
    unknown: "未知"
  };
  return map[value] || value || "未知";
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
  state.selectedRuleIds = new Set([...state.selectedRuleIds].filter((id) => state.endpoints.some((item) => item.id === id)));
  const active = data.status?.active || "unknown";
  const installed = Boolean(data.status?.installed);
  const realmVersion = realmVersionText(data.status?.realmVersion);
  setStateText($("#serviceState"), serviceStateText(active), active === "active" ? "state-ok" : "state-bad");
  setStateText($("#installState"), installed ? `已安装 / ${realmVersion}` : "未安装", installed ? "state-ok" : "state-warn");
  $("#osRelease").textContent = data.osRelease || "unknown";
  $("#webBasePath").textContent = data.webBasePath || API_BASE_PATH || "/";
  $("#webBasePathMenu").textContent = data.webBasePath || API_BASE_PATH || "/";
  $("#webPathInput").placeholder = data.webBasePath || "/rw-xxxxxxxxxxxx";
  $("#panelMenuState").textContent = "运行中";
  $("#autoStartState").textContent = autoStartText(data.status?.enabled);
  $("#realmMenuState").textContent = menuStateText(active);
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
  assertAddressPort($("#listen").value, "本地监听");
  assertUniqueListenPort($("#listen").value, $("#ruleId").value);
  assertAddressPort($("#remote").value, "目标地址");
  String($("#extraRemotes").value || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => assertAddressPort(item, "备用目标"));
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
  closeRuleModal();
  await loadStatus();
  state.rulesPage = Math.max(1, Math.ceil(state.endpoints.length / state.rulesPageSize));
  renderRules();
  await loadConfig();
}

async function deleteRule(id) {
  if (!confirm(`确认删除规则 #${id}？`)) return;
  await api(`/api/endpoints/${id}`, { method: "DELETE" });
  toast("规则已删除", "ok");
  state.selectedRuleIds.delete(Number(id));
  await loadStatus();
  await loadConfig();
}

async function toggleRule(id, enabled) {
  await api(`/api/endpoints/${id}/toggle`, { method: "POST", body: { enabled } });
  toast(enabled ? "规则已启动" : "规则已关闭", "ok");
  await loadStatus();
  await loadConfig();
}

async function bulkDeleteRules() {
  const ids = [...state.selectedRuleIds].sort((a, b) => a - b);
  if (!ids.length) throw new Error("请选择要删除的规则");
  if (!confirm(`确认删除选中的 ${ids.length} 条规则？`)) return;
  const data = await api("/api/endpoints/bulk-delete", { method: "POST", body: { ids } });
  state.selectedRuleIds.clear();
  toast(`已删除 ${data.deleted || ids.length} 条规则`, "ok");
  resetForm();
  await loadStatus();
  await loadConfig();
}

function toggleSelectAllRules() {
  const start = (state.rulesPage - 1) * state.rulesPageSize;
  const pageRules = state.endpoints.slice(start, start + state.rulesPageSize);
  if (!pageRules.length) return;
  const allSelected = pageRules.every((rule) => state.selectedRuleIds.has(rule.id));
  if (allSelected) {
    pageRules.forEach((rule) => state.selectedRuleIds.delete(rule.id));
  } else {
    pageRules.forEach((rule) => state.selectedRuleIds.add(rule.id));
  }
  renderRules();
}

function changeRulesPage(delta) {
  state.rulesPage += delta;
  renderRules();
}

async function serviceAction(action) {
  if (action === "install") {
    await api("/api/install", { method: "POST" });
    toast("安装/更新完成", "ok");
  } else if (action === "checkUpdate") {
    const data = await api("/api/update-check");
    toast(data.hasUpdate ? `发现新版本 ${data.latest}，当前 ${data.current}` : `已是最新版本 ${data.current}`, data.hasUpdate ? "info" : "ok");
  } else if (action === "status") {
    await loadStatus();
    toast("状态已刷新", "ok");
  } else {
    await api("/api/service", { method: "POST", body: { action } });
    toast(`服务已${action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}`, "ok");
  }
  await loadStatus();
}

async function managerAction(action) {
  const messages = {
    installDocker: "Docker 安装完成",
    installManager: "Docker 版网页管理安装完成",
    uninstallManager: "Docker 版网页管理已卸载",
    startManager: "网页管理已启动",
    stopManager: "网页管理已停止",
    restartManager: "网页管理已重启"
  };
  if (["uninstallManager", "stopManager", "restartManager"].includes(action)) {
    const ok = confirm("这个操作会影响当前网页管理服务，确认继续？");
    if (!ok) return;
  }
  await api("/api/manager", { method: "POST", body: { action } });
  toast(messages[action] || "操作完成", "ok");
  if (action !== "stopManager" && action !== "uninstallManager") await loadStatus();
}

async function saveCustomWebPath() {
  const value = $("#webPathInput").value.trim();
  if (!value) throw new Error("请输入新路径");
  const data = await api("/api/web-path", { method: "POST", body: { path: value } });
  toast(`路径已修改为 ${data.webBasePath}`, "ok");
  setTimeout(() => {
    location.href = `${data.webBasePath}/`;
  }, 900);
}

async function randomWebPath() {
  const ok = confirm("确认生成新的随机 16 位路径？修改后需要用新路径访问面板。");
  if (!ok) return;
  const data = await api("/api/web-path", { method: "POST", body: { random: true } });
  toast(`路径已修改为 ${data.webBasePath}`, "ok");
  setTimeout(() => {
    location.href = `${data.webBasePath}/`;
  }, 900);
}

async function changeWebPath() {
  const mode = document.querySelector('input[name="webPathMode"]:checked')?.value || "random";
  if (mode === "random") {
    await randomWebPath();
  } else {
    await saveCustomWebPath();
  }
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
  state.selectedRuleIds.clear();
  toast(`已导入 ${count} 条规则`, "ok");
  resetForm();
  await loadStatus();
  await loadConfig();
}

function bindEvents() {
  setTheme(savedTheme);
  setSidebarCollapsed(savedSidebarCollapsed);
  $("#openRuleModalBtn").addEventListener("click", () => {
    resetForm();
    openRuleModal();
  });
  $("#closeRuleModalBtn").addEventListener("click", closeRuleModal);
  $("#cancelRuleModalBtn").addEventListener("click", closeRuleModal);
  $("#ruleModalBackdrop").addEventListener("click", closeRuleModal);
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
  $("#themeToggleBtn").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  $("#sidebarToggleBtn").addEventListener("click", () => {
    setSidebarCollapsed(!$("#appView").classList.contains("sidebar-collapsed"));
  });
  $("#sidebarMobileOverlay").addEventListener("click", () => setSidebarCollapsed(true));
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
  $("#advancedToggleBtn").addEventListener("click", () => {
    setAdvancedOptions($("#advancedOptions").classList.contains("hidden"));
  });
  $("#exportRulesBtn").addEventListener("click", () => exportRules().catch((error) => toast(error.message, "error")));
  $("#importRulesBtn").addEventListener("click", () => $("#importRulesFile").click());
  $("#selectAllRulesBtn").addEventListener("click", toggleSelectAllRules);
  $("#bulkDeleteRulesBtn").addEventListener("click", () => bulkDeleteRules().catch((error) => toast(error.message, "error")));
  $("#prevRulesPageBtn").addEventListener("click", () => changeRulesPage(-1));
  $("#nextRulesPageBtn").addEventListener("click", () => changeRulesPage(1));
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
  $("#changeWebPathBtn").addEventListener("click", () => changeWebPath().catch((error) => toast(error.message, "error")));
  $("#install").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const manager = button.dataset.managerAction;
    if (manager) {
      managerAction(manager).catch((error) => toast(error.message, "error"));
      return;
    }
    if (button.hasAttribute("data-path-focus") || button.hasAttribute("data-path-edit")) {
      $(".path-manager").scrollIntoView({ behavior: "smooth", block: "center" });
      if (button.hasAttribute("data-path-edit")) {
        $("#webPathInput").focus();
      }
      return;
    }
    const scrollTarget = button.dataset.scroll;
    if (scrollTarget) {
      document.querySelector(scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const action = button.dataset.action;
    if (!action) return;
    serviceAction(action).catch((error) => toast(error.message, "error"));
  });
  $("#rulesList").addEventListener("click", (event) => {
    const selectId = event.target.dataset.selectRule;
    if (selectId) {
      const id = Number(selectId);
      if (event.target.checked) state.selectedRuleIds.add(id);
      else state.selectedRuleIds.delete(id);
      return;
    }
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    const toggleId = event.target.dataset.toggle;
    if (toggleId) {
      event.preventDefault();
      event.stopPropagation();
      toggleRule(toggleId, event.target.dataset.enabled === "true").catch((error) => toast(error.message, "error"));
      return;
    }
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
