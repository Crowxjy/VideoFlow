// ===================================================================
// AI 视频工作台 · 真实后端服务 (node:http + node:sqlite, 零 npm 依赖)
//   启动: node server/server.js   (默认 http://localhost:8080)
//   - 持久化: SQLite (data/videoflow.db)，重启不丢
//   - 异步生成: 真实任务队列 + provider 适配层(默认 LocalProvider 产真实文件)
//   - 鉴权: Bearer Token(可选，设 VF_TOKEN 开启)
//   - 同源托管前端静态资源 + /media 产物，避免 file:// 的 CORS/路径问题
//   - REST 契约见 openapi.yaml；前端 api.js 直接对接
// 环境变量:
//   PORT(8080) VF_TOKEN(鉴权,可空) VF_PROVIDER(local|real) VF_DB(数据库路径)
// ===================================================================
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { openDb, makeDao } from "./db.js";
import { makeProvider, makeSettings } from "./providers.js";
import { makeQueue } from "./queue.js";
import { ChatService } from "./chat.js";
import { unzip } from "./unzip.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");          // 前端静态目录（打包后为只读）
// 产物/数据目录：默认在仓库内（本地开发），可用环境变量覆盖到用户可写目录
// （Electron 等打包场景下 App 内部只读，须指向 ~/Library/Application Support/... ）
const MEDIA_DIR = process.env.VF_MEDIA_DIR || join(ROOT, "media");   // 产物目录
const DATA_DIR  = process.env.VF_DATA_DIR  || join(ROOT, "data");    // 数据/配置目录
const PORT = process.env.PORT || 8080;
// 监听地址：默认只绑回环，避免局域网内其它主机直连。需对外时显式设 VF_HOST=0.0.0.0。
const HOST = process.env.VF_HOST || "127.0.0.1";
const BASE = "/v1";
const TOKEN = process.env.VF_TOKEN || "";     // 为空则不校验

const db = openDb(process.env.VF_DB || join(DATA_DIR, "videoflow.db"));
const dao = makeDao(db);
const settings = makeSettings(DATA_DIR);
const provider = makeProvider(MEDIA_DIR, settings);
const queue = makeQueue(dao, provider, { concurrency: Number(process.env.VF_CONCURRENCY || 2) });
const chat = new ChatService(settings);
// 队列需要一个「找下一个 queued 任务」的能力（保持 SQL 集中在 server）
// 顺序衔接（chain=1）任务由 runChain 串行驱动，不进普通并发池，故排除。
queue.setQueuedFinder(() =>
  db.prepare(`SELECT * FROM gen_task WHERE status='queued' AND chain=0 ORDER BY created_at LIMIT 1`).get() || null);
// 启动时把历史 running 的普通任务复位为 queued（避免重启后卡死），并拉起队列
db.prepare(`UPDATE gen_task SET status='queued', progress=0 WHERE status='running' AND chain=0`).run();
// 链路任务重启后无法安全续跑（进程内串行状态已丢失），标记为 failed 供用户重新发起
db.prepare(`UPDATE gen_task SET status='failed', error='服务重启，顺序衔接链路已中断，请重新发起' WHERE status='running' AND chain=1`).run();
queue.kick();

// ---------- HTTP 工具 ----------
// CORS：只对同源/本地回环 Origin 放行跨源读取，避免恶意公网页面跨源调用本地 API。
// 同源请求不带 Origin（或同源）不受影响；Node CLI 不走浏览器 CORS，同样不受影响。
const CORS_BASE = {
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};
function corsFor(req) {
  const origin = req.headers["origin"];
  const h = { ...CORS_BASE };
  // 仅回环地址来源允许跨源读取（localhost / 127.0.0.1 / [::1]，任意端口）
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return h;
}
const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...(res._cors || CORS_BASE) });
  res.end(JSON.stringify(body));
};
const fail = (res, code, c, m) => json(res, code, { code: c, message: m });
// JSON 请求体：加大小上限，防止无鉴权请求无限累积打爆内存（默认 2MB）。
const readBody = (req, maxBytes = 2 * 1024 * 1024) => new Promise((r) => {
  let b = "", total = 0, aborted = false;
  req.on("data", (c) => {
    if (aborted) return;
    total += c.length;
    if (total > maxBytes) { aborted = true; req.destroy(); r({}); return; }
    b += c;
  });
  req.on("end", () => { if (!aborted) { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } } });
  req.on("error", () => r({}));
});
const readBinary = (req, maxBytes = 50 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let total = 0;
  req.on("data", (c) => {
    total += c.length;
    if (total > maxBytes) { req.destroy(); reject(new Error(`文件过大，单文件限制 ${Math.round(maxBytes / 1024 / 1024)}MB`)); return; }
    chunks.push(c);
  });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".yaml": "text/yaml" };

const MIME_TO_EXT = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg",
  "application/pdf": ".pdf",
};
function extToExt(mime) { return MIME_TO_EXT[mime] || ".bin"; }

// 净化客户端传入的扩展名，杜绝路径穿越（?ext=/../../evil.js）与非法字符。
// 只接受形如 ".mp4" 的纯字母数字后缀（去掉所有路径分隔符）；非法则回退到 mime 推断。
function safeExt(rawExt, mime) {
  if (!rawExt) return extToExt(mime);
  const cleaned = String(rawExt).replace(/^\.+/, "").replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned || cleaned.length > 8) return extToExt(mime);
  return "." + cleaned.toLowerCase();
}

// ---------- 资源包导入辅助 ----------
// 按扩展名推断 mime（导入时 zip 条目无 Content-Type，只能靠后缀）。
const EXT_TO_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  pdf: "application/pdf", json: "application/json", md: "text/markdown", txt: "text/plain",
};
// 素材可导入的媒体类型（其余如 .md/.json 视为文档，跳过实体导入但计入清单）。
const MEDIA_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "mp4", "webm", "mov", "mp3", "wav", "ogg"]);
// 归一化 zip 条目路径为素材类型标签：按目录名（含中文导出包约定）+ 扩展名双重判断。
function classifyEntry(path, ext) {
  const lower = path.toLowerCase();
  const isImg = ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext);
  const isVid = ["mp4", "webm", "mov"].includes(ext);
  const isAud = ["mp3", "wav", "ogg"].includes(ext);
  // 目录约定（兼容本项目导出包的中文目录名）
  if (/(^|\/)(character|角色|角色图)(\/|$)/.test(lower) && isImg) return "character";
  if (/(^|\/)(keyframes?|关键帧|首帧)(\/|$)/.test(lower) && isImg) return "keyframe";
  if (/(^|\/)(videos?|视频|成片|片段)(\/|$)/.test(lower) && isVid) return "video";
  if (/(^|\/)(voice|audio|配音|音频|旁白)(\/|$)/.test(lower) && isAud) return "voice";
  // 无目录线索时按媒体大类归档
  if (isVid) return "video";
  if (isAud) return "voice";
  if (isImg) return "image";
  return "other";
}

async function serveStatic(res, baseDir, rel, req) {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const fp = join(baseDir, safe);
  try {
    const s = await stat(fp);
    if (s.isDirectory()) return serveStatic(res, baseDir, join(rel, "index.html"), req);
    const ctype = MIME[extname(fp)] || "application/octet-stream";
    const cors = res._cors || CORS_BASE;
    // Range 支持：视频/音频 <video>/<audio> 会发 Range 请求以支持拖动与分段加载。
    // 不处理会导致浏览器整段拉取后中断 → ERR_INVALID_CHUNKED_ENCODING/ERR_ABORTED。
    const range = req?.headers?.range;
    if (range) {
      const mm = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (mm) {
        let start = mm[1] === "" ? null : parseInt(mm[1], 10);
        let end   = mm[2] === "" ? null : parseInt(mm[2], 10);
        const size = s.size;
        if (start === null) { start = size - end; end = size - 1; }  // 后缀区间 bytes=-N
        else if (end === null) end = size - 1;
        if (start > end || start < 0 || end >= size) {
          res.writeHead(416, { "Content-Range": `bytes */${size}`, ...cors });
          res.end(); return true;
        }
        const buf = await readFile(fp);
        res.writeHead(206, {
          "Content-Type": ctype, "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...cors,
        });
        res.end(buf.subarray(start, end + 1));
        return true;
      }
    }
    const buf = await readFile(fp);
    res.writeHead(200, { "Content-Type": ctype, "Accept-Ranges": "bytes", "Content-Length": buf.length, ...cors });
    res.end(buf);
    return true;
  } catch { return false; }
}

// ---------- 鉴权 ----------
function authed(req) {
  if (!TOKEN) return true;                 // 未配置 token -> 放行(本地开发)
  const h = req.headers["authorization"] || "";
  return h === `Bearer ${TOKEN}`;
}

// ---------- 路由 ----------
const server = createServer(async (req, res) => {
  res._cors = corsFor(req);   // 按请求 Origin 计算 CORS 头，供各响应函数复用
  if (req.method === "OPTIONS") { res.writeHead(204, res._cors); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname;

  // 产物
  if (p.startsWith("/media/")) {
    if (await serveStatic(res, MEDIA_DIR, p.slice("/media/".length), req)) return;
    return fail(res, 404, "NOT_FOUND", "产物不存在");
  }
  // 静态前端（非 /v1 一律走静态；根路径 -> index.html）
  if (!p.startsWith(BASE)) {
    const rel = p === "/" ? "index.html" : p.slice(1);
    if (await serveStatic(res, ROOT, rel, req)) return;
    return fail(res, 404, "NOT_FOUND", "页面不存在");
  }

  // ---- API：以下需要鉴权 ----
  if (!authed(req)) return fail(res, 401, "UNAUTHORIZED", "缺少或无效的访问令牌");
  p = p.slice(BASE.length) || "/";
  const m = req.method;
  const seg = p.split("/").filter(Boolean);

  try {
    // GET /settings  · PUT /settings
    if (seg[0] === "settings" && !seg[1]) {
      if (m === "GET") return json(res, 200, settings.publicView());
      if (m === "PUT") {
        const body = await readBody(req);
        // 兼容两种格式：{ group, patch } 或 { openai:{...}, ark:{...} }
        if (body && body.group && body.patch) settings.update(body.group, body.patch);
        else settings.updateAll(body || {});
        return json(res, 200, settings.publicView());
      }
    }

    // GET /projects · POST /projects
    if (seg[0] === "projects" && !seg[1]) {
      if (m === "GET") {
        const items = dao.listProjects();
        return json(res, 200, { page: 1, pageSize: items.length, total: items.length, items });
      }
      if (m === "POST") {
        const body = await readBody(req);
        if (!body?.name || !String(body.name).trim()) return fail(res, 400, "BAD_REQUEST", "name 必填");
        const p = dao.createProject({ name: String(body.name).trim(), spec: body.spec || {} });
        return json(res, 201, p);
      }
    }

    // /projects/{id}...
    if (seg[0] === "projects" && seg[1]) {
      const pid = seg[1];
      const proj = dao.getProject(pid);
      if (!proj) return fail(res, 404, "NOT_FOUND", "项目不存在");

      if (!seg[2] && m === "GET") return json(res, 200, proj);
      if (!seg[2] && m === "PATCH") {
        const body = await readBody(req);
        return json(res, 200, dao.updateProject(pid, body || {}));
      }
      if (!seg[2] && m === "DELETE") {
        dao.deleteProject(pid);
        return json(res, 200, { ok: true });
      }
      if (seg[2] === "brief") {
        if (m === "GET") return json(res, 200, dao.getBrief(pid));
        if (m === "PATCH") {
          const body = await readBody(req);
          const fields = body?.fields || body || {};
          return json(res, 200, dao.patchBriefFields(pid, fields));
        }
        if (m === "DELETE") {
          const k = url.searchParams.get("k") || "";
          if (!k) return fail(res, 400, "BAD_REQUEST", "k 必填");
          return json(res, 200, dao.deleteBriefField(pid, k));
        }
      }
      if (seg[2] === "dialogue") {
        if (m === "GET") return json(res, 200, dao.getDialogue(pid));
        if (m === "POST") {
          const { text } = await readBody(req);
          if (!text) return fail(res, 400, "BAD_REQUEST", "text 必填");
          return streamDialogue(req, res, pid, text);
        }
        // PUT /projects/{id}/dialogue  外部 Agent 直接落库一对 user/ai 消息（用 Agent 自己的模型生成时使用）
        if (m === "PUT") {
          const body = await readBody(req);
          const user = (body?.user || "").toString();
          const reply = (body?.reply || "").toString();
          const chips = Array.isArray(body?.chips) ? body.chips : [];
          if (user) dao.addDialogue(pid, "me", user, []);
          if (reply) dao.addDialogue(pid, "ai", reply, chips);
          return json(res, 200, { ok: true, dialogue: dao.getDialogue(pid) });
        }
      }
      if (seg[2] === "script" && m === "GET") return json(res, 200, dao.getScript(pid));
      // PUT /projects/{id}/script  外部 Agent 直接写入完整脚本（用 Agent 自己的模型生成时使用）
      if (seg[2] === "script" && m === "PUT") {
        const script = await readBody(req);
        if (!script || typeof script !== "object")
          return fail(res, 400, "BAD_REQUEST", "需要 JSON body：完整 script 对象");
        const saved = dao.saveScript(pid, script);
        return json(res, 200, saved);
      }
      // POST /projects/{id}/script:generate
      if (seg[2] && seg[2].startsWith("script:") && m === "POST") {
        const action = seg[2].slice("script:".length);
        if (action === "generate") {
          const brief = dao.getBrief(pid);
          const script = await chat.generateScript(brief, proj);
          const saved = dao.saveScript(pid, script);
          return json(res, 200, saved);
        }
      }
      if (seg[2] === "characters" && m === "GET") return json(res, 200, dao.getCharacters(pid));
      if (seg[2] === "scenes" && m === "GET") return json(res, 200, dao.getScenes(pid));
      if (seg[2] === "generic" && m === "GET") return json(res, 200, dao.getGeneric(pid));
      // POST /projects/{id}/generic-assets  上传通用素材（品牌 logo / 转场素材等）
      // 二进制流上传，元数据走 query: ?name=&type=&desc=&mime=
      if (seg[2] === "generic-assets" && m === "POST") {
        const name = url.searchParams.get("name") || "";
        const type = url.searchParams.get("type") || "other";
        const desc = url.searchParams.get("desc") || "";
        const mime = url.searchParams.get("mime") || req.headers["content-type"] || "application/octet-stream";
        const ext  = safeExt(url.searchParams.get("ext"), mime);
        if (!name.trim()) return fail(res, 400, "BAD_REQUEST", "name 必填");
        let buf;
        try { buf = await readBinary(req); }
        catch (e) { return fail(res, 413, "PAYLOAD_TOO_LARGE", e.message); }
        if (!buf.length) return fail(res, 400, "BAD_REQUEST", "文件内容为空");
        await mkdir(MEDIA_DIR, { recursive: true });
        const fname = `ga_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${ext}`;
        await writeFile(join(MEDIA_DIR, fname), buf);
        const row = dao.addGenericAsset(pid, {
          name: name.trim(), desc: desc.trim(), type: type.trim() || "other",
          url: `/media/${fname}`, mime, size: buf.length,
        });
        return json(res, 201, { id: row.id, name: row.name, desc: row.descr, type: row.asset_type,
          url: row.url, mime: row.mime, size: row.size, createdAt: row.created_at });
      }
      // POST /projects/{id}/asset-pack:import  上传资源包(.zip)，解析并批量导入素材
      //   兼容两类：① 本项目导出的成片包（videos/keyframes/character 约定目录）
      //            ② 任意素材 zip（按扩展名归类为 image/video/voice/other）
      //   每个媒体文件落 generic_asset 表（可在素材库预览）；.md/.json 等文档跳过实体导入。
      if (seg[2] === "asset-pack:import" && m === "POST") {
        let zipBuf;
        try { zipBuf = await readBinary(req, 300 * 1024 * 1024); }  // 整包上限 300MB
        catch (e) { return fail(res, 413, "PAYLOAD_TOO_LARGE", e.message); }
        if (!zipBuf.length) return fail(res, 400, "BAD_REQUEST", "资源包内容为空");
        let parsed;
        try { parsed = unzip(zipBuf); }
        catch (e) { return fail(res, 400, "BAD_ZIP", e.message); }

        await mkdir(MEDIA_DIR, { recursive: true });
        const imported = [], skipped = [...parsed.skipped];
        for (const entry of parsed.entries) {
          // Zip Slip 防护：归一化并拒绝穿越；只取纯文件名用于展示。
          const safe = normalize(entry.path).replace(/^(\.\.[/\\])+/, "");
          if (safe.includes("..")) { skipped.push({ path: entry.path, reason: "路径非法" }); continue; }
          const base = safe.split("/").pop() || "asset";
          const rawExt = (base.includes(".") ? base.split(".").pop() : "").toLowerCase();
          // 跳过隐藏文件与非媒体文档（仍计入 skipped 供用户知情）
          if (base.startsWith(".")) { skipped.push({ path: entry.path, reason: "隐藏文件" }); continue; }
          if (!MEDIA_EXTS.has(rawExt)) { skipped.push({ path: entry.path, reason: `非媒体文件(.${rawExt || "?"})` }); continue; }

          const type = classifyEntry(safe, rawExt);
          const mime = EXT_TO_MIME[rawExt] || "application/octet-stream";
          const ext  = safeExt(rawExt, mime);
          const fname = `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${ext}`;
          await writeFile(join(MEDIA_DIR, fname), entry.data);
          const row = dao.addGenericAsset(pid, {
            name: base, desc: `资源包导入 · ${safe}`, type,
            url: `/media/${fname}`, mime, size: entry.data.length,
          });
          imported.push({ id: row.id, name: row.name, type: row.asset_type,
            url: row.url, mime: row.mime, size: row.size });
        }
        return json(res, 201, { imported: imported.length, skipped: skipped.length,
          items: imported, skippedDetail: skipped });
      }
      if (seg[2] === "timeline" && m === "GET") return json(res, 200, dao.getTimeline(pid));
      // POST /projects/{id}/media:ingest?kind=&refId=  外部 Agent 交付媒体产物（文生图/配音/视频等）
      // 二进制流上传：宿主 Agent 用自身能力生成后回写，跳过后端生成通道。
      if (seg[2] === "media:ingest" && m === "POST") {
        const kind = url.searchParams.get("kind") || "";
        const refId = url.searchParams.get("refId") || "";
        const mime = url.searchParams.get("mime") || req.headers["content-type"] || "application/octet-stream";
        const ext  = safeExt(url.searchParams.get("ext"), mime);
        const width  = Number(url.searchParams.get("width"))  || null;
        const height = Number(url.searchParams.get("height")) || null;
        const durationS = Number(url.searchParams.get("durationS")) || null;
        const hasAlpha = url.searchParams.get("hasAlpha") === "1";
        const KINDS = ["char_ref", "keyframe", "fx", "video", "voice"];
        if (!KINDS.includes(kind)) return fail(res, 400, "BAD_REQUEST", `kind 必须是 ${KINDS.join("/")}`);
        let buf;
        try { buf = await readBinary(req); }
        catch (e) { return fail(res, 413, "PAYLOAD_TOO_LARGE", e.message); }
        if (!buf.length) return fail(res, 400, "BAD_REQUEST", "文件内容为空");
        await mkdir(MEDIA_DIR, { recursive: true });
        const fname = `ing_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${ext}`;
        await writeFile(join(MEDIA_DIR, fname), buf);
        const r = dao.ingestMedia(pid, {
          kind, refId: refId || null, url: `/media/${fname}`, mime,
          width, height, duration_s: durationS, has_alpha: hasAlpha,
        });
        return json(res, 201, { ok: true, kind, refId: refId || null, ...r, mime, size: buf.length });
      }
      if (seg[2] === "export" && m === "POST") {
        const t = dao.createExport(pid);
        dao.touchProjectStatus(pid, "editing");
        queue.submit(dao.rawTask(t.id));
        return json(res, 202, t);
      }
    }

    // /scenes/{id}/prompts (GET / PUT)
    if (seg[0] === "scenes" && seg[1] && seg[2] === "prompts") {
      if (m === "GET") return json(res, 200, dao.getPrompts(seg[1]));
      if (m === "PUT") {
        const body = await readBody(req);
        Object.entries(body).forEach(([pkey, text]) => {
          const kind = pkey.startsWith("char_") ? "char_ref" : pkey === "kf" ? "keyframe" : pkey === "fx" ? "fx" : "keyframe";
          dao.upsertPrompt(seg[1], pkey, kind, pkey, "", String(text));
        });
        return json(res, 200, dao.getPrompts(seg[1]));
      }
    }

    // /scenes/{id}/params (GET / PATCH) —— 逐镜的图片尺寸 / 视频比例·分辨率·时长
    if (seg[0] === "scenes" && seg[1] && seg[2] === "params") {
      if (m === "GET") return json(res, 200, dao.getSceneParams(seg[1]) || {});
      if (m === "PATCH") {
        const body = (await readBody(req)) || {};
        const saved = dao.updateSceneParams(seg[1], {
          imgSize: body.imgSize, videoRatio: body.videoRatio,
          videoResolution: body.videoResolution, videoDurationS: body.videoDurationS,
        });
        if (!saved) return fail(res, 404, "NOT_FOUND", "分镜不存在");
        return json(res, 200, saved);
      }
    }

    // DELETE /generic-assets/{id}
    if (seg[0] === "generic-assets" && seg[1] && m === "DELETE") {
      const row = dao.deleteGenericAsset(seg[1]);
      if (row?.url && row.url.startsWith("/media/")) {
        const fname = row.url.slice("/media/".length);
        const safe = normalize(fname).replace(/^(\.\.[/\\])+/, "");
        await unlink(join(MEDIA_DIR, safe)).catch(() => { /* 文件已不在，忽略 */ });
      }
      return json(res, 200, { ok: true });
    }

    // /characters/{id}:lock
    if (seg[0] === "characters" && seg[1]) {
      const [id, action] = seg[1].split(":");
      if (m === "POST" && action === "lock") {
        const c = dao.lockCharacter(id);
        if (!c) return fail(res, 404, "NOT_FOUND", "角色不存在");
        return json(res, 200, { id: c.id, name: c.name, locked: !!c.locked, version: c.version });
      }
    }

    // POST /gen-chain —— 顺序衔接生成：按 items 顺序串行生成视频，
    // 把上一幕视频尾帧作为下一幕首帧注入（本幕关键帧参考仍保留）。
    if (seg[0] === "gen-chain" && !seg[1]) {
      if (m === "POST") {
        const { projectId, items = [] } = await readBody(req);
        if (!projectId) return fail(res, 400, "BAD_REQUEST", "projectId 必填");
        if (!dao.getProject(projectId)) return fail(res, 404, "NOT_FOUND", "项目不存在");
        const vids = items.filter((it) => (it.kind || "video") === "video");
        if (!vids.length) return fail(res, 400, "BAD_REQUEST", "顺序衔接至少需要 1 个 video 任务");
        // 按传入顺序建链路任务（chain=1，不进普通并发池）
        const created = vids.map((it) => {
          const resolved = dao.resolveGenInput("video", it.refId);
          const t = dao.createTask(projectId, { ...resolved, ...it, kind: "video", chain: true });
          return dao.rawTask(t.id);
        });
        // 串行驱动，后台执行；立即 202 返回任务列表供前端轮询
        queue.runChain(created).catch((e) => console.error("[gen-chain]", e));
        return json(res, 202, created.map((r) => dao.getTask(r.id)));
      }
    }

    // GET /gen-tasks ; POST /gen-tasks
    if (seg[0] === "gen-tasks" && !seg[1]) {
      if (m === "GET") {
        const pid = url.searchParams.get("projectId");
        if (!pid) return fail(res, 400, "BAD_REQUEST", "projectId 必填");
        const status = url.searchParams.get("status");
        return json(res, 200, dao.getTasks(pid, status || undefined));
      }
      if (m === "POST") {
        const { projectId, items = [] } = await readBody(req);
        if (!projectId) return fail(res, 400, "BAD_REQUEST", "projectId 必填");
        if (!dao.getProject(projectId)) return fail(res, 404, "NOT_FOUND", "项目不存在");
        const created = items.map((it) => {
          // 回填该幕/角色已存的 prompt 与参考图（显式传入的字段优先）
          const resolved = dao.resolveGenInput(it.kind, it.refId);
          const t = dao.createTask(projectId, { ...resolved, ...it });
          queue.submit(dao.rawTask(t.id));
          return t;
        });
        return json(res, 202, created);
      }
    }
    // /gen-tasks/{id}[:retry|:cancel]
    if (seg[0] === "gen-tasks" && seg[1]) {
      const [id, action] = seg[1].split(":");
      const t = dao.getTask(id);
      if (!t) return fail(res, 404, "NOT_FOUND", "任务不存在");
      if (m === "GET") return json(res, 200, t);
      if (m === "POST" && action === "retry") return json(res, 202, queue.retry(id));
      if (m === "POST" && action === "cancel") return json(res, 200, queue.cancel(id));
    }

    return fail(res, 404, "NOT_FOUND", "资源不存在");
  } catch (e) {
    console.error("[error]", e);
    return fail(res, 500, "INTERNAL", String(e.message || e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[VideoFlow] 真实后端已启动 → http://localhost:${PORT}`);
  console.log(`[VideoFlow] 前端(同源) → http://localhost:${PORT}/   API → http://localhost:${PORT}${BASE}`);
  console.log(`[VideoFlow] Provider=${provider.name()}  鉴权=${TOKEN ? "开" : "关"}  并发=${process.env.VF_CONCURRENCY || 2}`);
  if (provider.name() === "real") {
    const s = settings.channelStatus();
    const ok = (b) => (b ? "✓" : "✗");
    console.log(`[VideoFlow] 通道凭证 → OpenAI 图像 ${ok(s.openai.ready)}  | 火山方舟 Seedance ${ok(s.ark.ready)}  | 火山 TTS ${ok(s.volcTts.ready)}  | Chat 对话 ${ok(s.chat.ready)}`);
    console.log(`[VideoFlow] 在页面右上角「⚙ 设置」可在线配置/修改，无需重启`);
  }
});

// ---------- SSE 流式对话 ----------
async function streamDialogue(req, res, pid, text) {
  // 先写用户消息
  dao.addDialogue(pid, "me", text);

  // 准备 SSE 头
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(res._cors || CORS_BASE),
  });
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const history = dao.getDialogue(pid); // 含刚写入的用户消息
    const brief   = dao.getBrief(pid);

    // 1) 流式回复
    let full = "";
    await chat.streamReply(history, brief, async (delta) => {
      full += delta;
      send("token", { delta });
    });
    dao.addDialogue(pid, "ai", full);

    // 2) 结构化抽取 brief patch（用更新后的 history 再调一次）
    const history2 = dao.getDialogue(pid);
    const { patch, chips } = await chat.extractBriefPatch(history2, brief, full).catch(() => ({ patch:{}, chips:[] }));
    let updatedBrief = brief;
    if (patch && Object.keys(patch).length) updatedBrief = dao.upsertBriefPatch(pid, patch);
    if (chips?.length) dao.tagLastUserMessage(pid, chips);

    send("brief", { brief: updatedBrief, chips, patch });
    send("done", { ok: true });
  } catch (e) {
    console.error("[dialogue]", e);
    send("error", { message: String(e.message || e) });
    send("done", { ok: false });
  } finally {
    res.end();
  }
}
