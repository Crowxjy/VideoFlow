/* ============ API 客户端层 ============
 * 单一数据源：始终走后端 HTTP /v1（同源或显式配置）。
 *
 * baseURL 解析优先级：
 *   1) window.VF_API_BASE
 *   2) localStorage["vf_api"]
 *   3) 若页面经 http(s) 由后端同源托管 → "<origin>/v1"
 *   4) 默认 "http://localhost:8080/v1"
 *
 * 鉴权：window.VF_TOKEN 或 localStorage["vf_token"]（Bearer）。
 * 当前项目：localStorage["vf_pid"]（由 UI 选择/创建后写入）。
 * ====================================================================== */
const API = (() => {
  const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lset = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const ldel = (k) => { try { localStorage.removeItem(k); } catch {} };

  const sameOrigin = (typeof location !== "undefined" && /^https?:$/.test(location.protocol))
    ? location.origin + "/v1" : null;

  let base =
    (typeof window !== "undefined" && window.VF_API_BASE) ||
    ls("vf_api") || sameOrigin || "http://localhost:8080/v1";
  let token = (typeof window !== "undefined" && window.VF_TOKEN) || ls("vf_token") || "";
  let pid   = ls("vf_pid") || "";

  const TIMEOUT_MS = 15000;
  const RETRIES = 2;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function once(method, path, body, { timeout = TIMEOUT_MS } = {}) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeout);
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    return fetch(base + path, {
      method, headers, signal: ctrl.signal,
      body: body != null ? JSON.stringify(body) : undefined,
    }).finally(() => clearTimeout(tm));
  }

  async function http(method, path, body, opts = {}) {
    const idempotent = method === "GET";
    const maxAttempts = idempotent ? RETRIES + 1 : 1;
    let lastErr;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await once(method, path, body, opts);
        if (res.status === 401 || res.status === 403)
          throw Object.assign(new Error("未授权：请检查访问令牌"), { status: res.status });
        if (res.status === 429 || res.status >= 500) {
          if (idempotent && i < maxAttempts - 1) { await sleep(300 * (i + 1)); continue; }
        }
        if (!res.ok) {
          let err; try { err = await res.json(); } catch { err = { message: res.statusText }; }
          throw Object.assign(new Error(err.message || `请求失败(${res.status})`), { status: res.status, body: err });
        }
        return res.status === 204 ? null : res.json();
      } catch (e) {
        lastErr = e;
        const retriable = e.name === "AbortError" || e.name === "TypeError";
        if (idempotent && retriable && i < maxAttempts - 1) { await sleep(300 * (i + 1)); continue; }
        throw lastErr;
      }
    }
    throw lastErr;
  }

  // SSE 流式：POST body，解析 event/data 行；监听 token / brief / error / done。
  async function streamSSE(path, body, { onToken, onBrief, timeout = 120_000 } = {}) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeout);
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (token) headers["Authorization"] = "Bearer " + token;
    let res;
    try {
      res = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body || {}), signal: ctrl.signal });
    } finally { clearTimeout(tm); }
    if (!res.ok || !res.body) {
      let err; try { err = await res.json(); } catch { err = { message: res.statusText }; }
      throw Object.assign(new Error(err.message || `请求失败(${res.status})`), { status: res.status });
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "", brief = null, chips = [], patch = {};
    let lastErr = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let event = "message", data = "";
        for (const ln of block.split("\n")) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) data += ln.slice(5).trim();
        }
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (event === "token") {
          if (parsed?.delta) { full += parsed.delta; onToken?.(parsed.delta, full); }
        } else if (event === "brief") {
          brief = parsed.brief; chips = parsed.chips || []; patch = parsed.patch || {};
          onBrief?.({ brief, chips, patch });
        } else if (event === "error") {
          lastErr = new Error(parsed.message || "对话失败");
        }
      }
    }
    if (lastErr) throw lastErr;
    return { reply: { role: "ai", text: full, chips }, brief, chips, patch };
  }

  const PID = () => pid;
  const setPid = (next) => { pid = next || ""; pid ? lset("vf_pid", pid) : ldel("vf_pid"); };

  return {
    getBase: () => base,
    getPid: PID,
    hasPid: () => !!pid,
    hasToken: () => !!token,
    setBase(url) { base = url.replace(/\/$/, ""); lset("vf_api", base); },
    setToken(tok) { token = tok || ""; token ? lset("vf_token", token) : ldel("vf_token"); },
    setPid,

    // ---- 项目 CRUD ----
    listProjects: () => http("GET", `/projects`),
    createProject: (body) => http("POST", `/projects`, body),
    updateProject: (id, body) => http("PATCH", `/projects/${id}`, body),
    deleteProject: (id) => http("DELETE", `/projects/${id}`),
    getProject: () => http("GET", `/projects/${PID()}`),

    // ---- 读 ----
    getBrief:      () => http("GET", `/projects/${PID()}/brief`),
    getDialogue:   () => http("GET", `/projects/${PID()}/dialogue`),
    getScript:     () => http("GET", `/projects/${PID()}/script`),
    getCharacters: () => http("GET", `/projects/${PID()}/characters`),
    getScenes:     () => http("GET", `/projects/${PID()}/scenes`),
    getGeneric:    () => http("GET", `/projects/${PID()}/generic`),
    getTasks:      (status) =>
      http("GET", `/gen-tasks?projectId=${PID()}${status ? "&status=" + status : ""}`),
    getTimeline:   () => http("GET", `/projects/${PID()}/timeline`),

    // ---- 写 ----
    // 需求单字段编辑回写：{ fields: { 字段名: 值 } }
    patchBrief: (fields) => http("PATCH", `/projects/${PID()}/brief`, { fields }),
    deleteBriefField: (k) => http("DELETE", `/projects/${PID()}/brief?k=${encodeURIComponent(k)}`),

    // 脚本生成（LLM 同步生成；前端 await 返回完整脚本）
    generateScript: () => http("POST", `/projects/${PID()}/script:generate`, {}),

    // 流式对话：onToken(delta) 逐字回调；返回 Promise<{ reply, brief, chips, patch }>
    sendMessage: (text, { onToken, onBrief } = {}) =>
      streamSSE(`/projects/${PID()}/dialogue`, { text }, { onToken, onBrief }),

    submitGen: (items) => http("POST", `/gen-tasks`, { projectId: PID(), items }),
    submitChain: (items) => http("POST", `/gen-chain`, { projectId: PID(), items }),
    pollTask: (id) => http("GET", `/gen-tasks/${id}`),
    retryTask: (id) => http("POST", `/gen-tasks/${id}:retry`),
    cancelTask: (id) => http("POST", `/gen-tasks/${id}:cancel`),
    lockCharacter: (id) => http("POST", `/characters/${id}:lock`),
    getPrompts: (sceneNodeId) => http("GET", `/scenes/${sceneNodeId}/prompts`),
    savePrompts: (sceneNodeId, prompts) => http("PUT", `/scenes/${sceneNodeId}/prompts`, prompts),
    exportFilm: () => http("POST", `/projects/${PID()}/export`),

    // ---- 通用素材上传/删除 ----
    uploadGenericAsset(file, { name, type, desc }) {
      const params = new URLSearchParams({
        name: name || file.name || "未命名素材",
        type: type || "other",
        desc: desc || "",
        mime: file.type || "application/octet-stream",
        ext:  "." + (file.name?.split(".").pop() || "bin"),
      });
      const headers = { "Content-Type": file.type || "application/octet-stream" };
      if (token) headers["Authorization"] = "Bearer " + token;
      return fetch(`${base}/projects/${PID()}/generic-assets?${params.toString()}`, {
        method: "POST", headers, body: file,
      }).then(async r => {
        if (!r.ok) {
          let err; try { err = await r.json(); } catch { err = { message: r.statusText }; }
          throw Object.assign(new Error(err.message || `上传失败(${r.status})`), { status: r.status });
        }
        return r.json();
      });
    },
    deleteGenericAsset: (id) => http("DELETE", `/generic-assets/${id}`),

    // ---- 在线模型凭证配置 ----
    getSettings: () => http("GET", `/settings`),
    saveSettings: (patch) => http("PUT", `/settings`, patch),
  };
})();

if (typeof window !== "undefined") window.API = API;
