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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");          // 前端静态目录
const MEDIA_DIR = join(ROOT, "media");        // 产物目录
const DATA_DIR  = join(ROOT, "data");         // 数据/配置目录
const PORT = process.env.PORT || 8080;
const BASE = "/v1";
const TOKEN = process.env.VF_TOKEN || "";     // 为空则不校验

const db = openDb(process.env.VF_DB || join(DATA_DIR, "videoflow.db"));
const dao = makeDao(db);
const settings = makeSettings(DATA_DIR);
const provider = makeProvider(MEDIA_DIR, settings);
const queue = makeQueue(dao, provider, { concurrency: Number(process.env.VF_CONCURRENCY || 2) });
const chat = new ChatService(settings);
// 队列需要一个「找下一个 queued 任务」的能力（保持 SQL 集中在 server）
queue.setQueuedFinder(() =>
  db.prepare(`SELECT * FROM gen_task WHERE status='queued' ORDER BY created_at LIMIT 1`).get() || null);
// 启动时把历史 running 任务复位为 queued（避免重启后卡死），并拉起队列
db.prepare(`UPDATE gen_task SET status='queued', progress=0 WHERE status='running'`).run();
queue.kick();

// ---------- HTTP 工具 ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};
const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...CORS });
  res.end(JSON.stringify(body));
};
const fail = (res, code, c, m) => json(res, code, { code: c, message: m });
const readBody = (req) => new Promise((r) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } });
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

async function serveStatic(res, baseDir, rel) {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const fp = join(baseDir, safe);
  try {
    const s = await stat(fp);
    if (s.isDirectory()) return serveStatic(res, baseDir, join(rel, "index.html"));
    const buf = await readFile(fp);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream", ...CORS });
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
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname;

  // 产物
  if (p.startsWith("/media/")) {
    if (await serveStatic(res, MEDIA_DIR, p.slice("/media/".length))) return;
    return fail(res, 404, "NOT_FOUND", "产物不存在");
  }
  // 静态前端（非 /v1 一律走静态；根路径 -> index.html）
  if (!p.startsWith(BASE)) {
    const rel = p === "/" ? "index.html" : p.slice(1);
    if (await serveStatic(res, ROOT, rel)) return;
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
        const ext  = url.searchParams.get("ext") || extToExt(mime);
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
      if (seg[2] === "timeline" && m === "GET") return json(res, 200, dao.getTimeline(pid));
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
          const t = dao.createTask(projectId, it);
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

server.listen(PORT, () => {
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
