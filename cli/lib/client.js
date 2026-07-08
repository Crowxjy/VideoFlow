// ===================================================================
// VideoFlow Node 客户端：包装 REST + SSE，供 CLI / 第三方 Agent 复用
//   零 npm 依赖（仅 Node 18+ 内置 fetch / ReadableStream）
// ===================================================================

export function makeClient({ base, token, projectId } = {}) {
  let _base  = (base || process.env.VIDEOFLOW_BASE  || "http://localhost:8080/v1").replace(/\/$/, "");
  let _token = token || process.env.VIDEOFLOW_TOKEN || "";
  let _pid   = projectId || process.env.VIDEOFLOW_PID || "";

  const headers = (extra = {}) => {
    const h = { "Content-Type": "application/json", ...extra };
    if (_token) h.Authorization = "Bearer " + _token;
    return h;
  };

  async function http(method, path, body, { stream = false } = {}) {
    const res = await fetch(_base + path, {
      method,
      headers: stream ? headers({ Accept: "text/event-stream" }) : headers(),
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let err; try { err = await res.json(); } catch { err = { message: res.statusText }; }
      const msg = err.message || `请求失败(${res.status})`;
      throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${msg}`), { status: res.status, body: err });
    }
    if (stream) return res;
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  function pidOrThrow() {
    if (!_pid) throw new Error("尚未设置项目 ID。先 `videoflow projects use <id>` 或传 --project=<id>");
    return _pid;
  }

  // ---- SSE 流式对话：onToken(delta, full) 回调，return 完整内容 ----
  async function streamDialogue(text, { onToken, onBrief } = {}) {
    const res = await http("POST", `/projects/${pidOrThrow()}/dialogue`, { text }, { stream: true });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "", brief = null, chips = [], patch = {};
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
        if (event === "token" && parsed?.delta) { full += parsed.delta; onToken?.(parsed.delta, full); }
        else if (event === "brief") {
          brief = parsed.brief; chips = parsed.chips || []; patch = parsed.patch || {};
          onBrief?.({ brief, chips, patch });
        } else if (event === "error") throw new Error(parsed?.message || "对话失败");
      }
    }
    return { reply: full, brief, chips, patch };
  }

  // ---- 上传通用素材 ----
  async function uploadGenericAsset(filePath, { name, type = "other", desc = "" } = {}) {
    const { readFile } = await import("node:fs/promises");
    const { basename, extname } = await import("node:path");
    const buf = await readFile(filePath);
    const fname = basename(filePath);
    const ext = extname(fname) || ".bin";
    const mime = guessMime(ext);
    const params = new URLSearchParams({ name: name || fname, type, desc, mime, ext });
    const res = await fetch(`${_base}/projects/${pidOrThrow()}/generic-assets?${params}`, {
      method: "POST",
      headers: _token ? { "Content-Type": mime, Authorization: "Bearer " + _token } : { "Content-Type": mime },
      body: buf,
    });
    if (!res.ok) throw new Error(`上传失败(${res.status})`);
    return res.json();
  }

  // ---- 交付宿主 Agent 生成的媒体产物（文生图/配音/视频等），绑定到分镜/角色 ----
  async function ingestMedia(filePath, { kind, refId, width, height, durationS, hasAlpha } = {}) {
    const { readFile } = await import("node:fs/promises");
    const { extname } = await import("node:path");
    const buf = await readFile(filePath);
    const ext = extname(filePath) || ".bin";
    const mime = guessMime(ext);
    const params = new URLSearchParams({ kind: kind || "", mime, ext });
    if (refId) params.set("refId", refId);
    if (width) params.set("width", String(width));
    if (height) params.set("height", String(height));
    if (durationS) params.set("durationS", String(durationS));
    if (hasAlpha) params.set("hasAlpha", "1");
    const res = await fetch(`${_base}/projects/${pidOrThrow()}/media:ingest?${params}`, {
      method: "POST",
      headers: _token ? { "Content-Type": mime, Authorization: "Bearer " + _token } : { "Content-Type": mime },
      body: buf,
    });
    if (!res.ok) {
      let err; try { err = await res.json(); } catch { err = { message: res.statusText }; }
      throw Object.assign(new Error(err.message || `交付失败(${res.status})`), { status: res.status, body: err });
    }
    return res.json();
  }

  return {
    config: () => ({ base: _base, hasToken: !!_token, projectId: _pid }),
    setBase: (v) => { _base = v.replace(/\/$/, ""); },
    setToken: (v) => { _token = v || ""; },
    setPid: (v) => { _pid = v || ""; },

    health: () => http("GET", "/settings"),

    // 项目
    listProjects: () => http("GET", "/projects"),
    createProject: ({ name, aspect = "16:9", lang = "zh" }) =>
      http("POST", "/projects", { name, spec: { aspect, lang } }),
    getProject: (id = pidOrThrow()) => http("GET", `/projects/${id}`),
    updateProject: (id, patch) => http("PATCH", `/projects/${id}`, patch),
    deleteProject: (id) => http("DELETE", `/projects/${id}`),

    // 需求单 / 对话 / 脚本
    getBrief: () => http("GET", `/projects/${pidOrThrow()}/brief`),
    patchBrief: (fields) => http("PATCH", `/projects/${pidOrThrow()}/brief`, { fields }),
    deleteBriefField: (k) => http("DELETE", `/projects/${pidOrThrow()}/brief?k=${encodeURIComponent(k)}`),
    getDialogue: () => http("GET", `/projects/${pidOrThrow()}/dialogue`),
    sendMessage: streamDialogue,
    putDialogue: ({ user, reply, chips }) =>
      http("PUT", `/projects/${pidOrThrow()}/dialogue`, { user, reply, chips }),
    getScript: () => http("GET", `/projects/${pidOrThrow()}/script`),
    generateScript: () => http("POST", `/projects/${pidOrThrow()}/script:generate`, {}),
    putScript: (script) => http("PUT", `/projects/${pidOrThrow()}/script`, script),

    // 素材列表
    getCharacters: () => http("GET", `/projects/${pidOrThrow()}/characters`),
    getScenes: () => http("GET", `/projects/${pidOrThrow()}/scenes`),
    getGeneric: () => http("GET", `/projects/${pidOrThrow()}/generic`),
    getScenePrompts: (sceneNodeId) => http("GET", `/scenes/${sceneNodeId}/prompts`),
    uploadGenericAsset,
    ingestMedia,
    deleteGenericAsset: (id) => http("DELETE", `/generic-assets/${id}`),

    // 生成任务
    submitGen: (items) => http("POST", "/gen-tasks", { projectId: pidOrThrow(), items }),
    submitChain: (items) => http("POST", "/gen-chain", { projectId: pidOrThrow(), items }),
    listTasks: (status) =>
      http("GET", `/gen-tasks?projectId=${pidOrThrow()}${status ? "&status=" + status : ""}`),
    pollTask: (id) => http("GET", `/gen-tasks/${id}`),
    retryTask: (id) => http("POST", `/gen-tasks/${id}:retry`),
    cancelTask: (id) => http("POST", `/gen-tasks/${id}:cancel`),

    // 导出
    exportFilm: () => http("POST", `/projects/${pidOrThrow()}/export`),

    // 设置
    getSettings: () => http("GET", "/settings"),
    saveSettings: (patch) => http("PUT", "/settings", patch),
  };
}

function guessMime(ext) {
  const m = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".json": "application/json", ".txt": "text/plain",
  };
  return m[ext.toLowerCase()] || "application/octet-stream";
}
