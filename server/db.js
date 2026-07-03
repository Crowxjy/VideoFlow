// ===================================================================
// AI 视频工作台 · 数据库层 (node:sqlite, 零依赖 / 免编译 / 持久化)
// - SQLite 方言：用 TEXT+CHECK 模拟 PG 枚举，AUTOINCREMENT 代替 SERIAL，
//   TEXT 存 ISO 时间与 JSON。与 schema.sql / types.ts 字段对齐。
// - 首次启动自动建表 + 注入种子数据（与原 data.js 同构），重启不丢。
// ===================================================================
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const now = () => new Date().toISOString();
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function openDb(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

// 创建项目时使用的标准 brief 字段集（拍片前必需的需求要素）
export const BRIEF_TEMPLATE = [
  "视频类型", "传播渠道", "目标受众", "时长 / 画幅",
  "核心卖点", "品牌调性", "品牌主色", "参考案例",
];

// ---------- 建表 ----------
function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'drafting'
      CHECK (status IN ('drafting','scripting','generating','editing','done','archived')),
    duration_s INTEGER NOT NULL DEFAULT 0, aspect TEXT NOT NULL DEFAULT '16:9',
    lang TEXT NOT NULL DEFAULT 'zh', style TEXT NOT NULL DEFAULT '',
    owner_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS brief (
    project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    completeness INTEGER NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100)
  );
  CREATE TABLE IF NOT EXISTS brief_field (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES brief(project_id) ON DELETE CASCADE,
    k TEXT NOT NULL, v TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0,
    ord INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS dialogue_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('ai','me')),
    text TEXT NOT NULL, chips TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS character (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
    voice TEXT NOT NULL DEFAULT '', descr TEXT NOT NULL DEFAULT '', img TEXT
  );
  CREATE TABLE IF NOT EXISTS scene (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', img TEXT
  );
  CREATE TABLE IF NOT EXISTS generic_asset (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', asset_type TEXT NOT NULL DEFAULT 'other',
    url TEXT, mime TEXT, size INTEGER, created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS script (
    project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    total_scenes INTEGER NOT NULL DEFAULT 0, duration_s INTEGER NOT NULL DEFAULT 0,
    style TEXT NOT NULL DEFAULT '', bgm TEXT NOT NULL DEFAULT '', narration TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS scene_node (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '',
    scene_ref_id TEXT, scene_ref TEXT NOT NULL DEFAULT '',
    fx_need INTEGER NOT NULL DEFAULT 0, fx_type TEXT NOT NULL DEFAULT '',
    fx_intensity TEXT CHECK (fx_intensity IN ('low','mid','high') OR fx_intensity IS NULL),
    narration TEXT NOT NULL DEFAULT '',
    kf_state TEXT NOT NULL DEFAULT 'pending' CHECK (kf_state IN ('pending','generating','done','failed')),
    kf TEXT, UNIQUE (project_id, ord)
  );
  CREATE TABLE IF NOT EXISTS scene_node_char (
    scene_node_id TEXT NOT NULL REFERENCES scene_node(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL,
    PRIMARY KEY (scene_node_id, character_id)
  );
  CREATE TABLE IF NOT EXISTS prompt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_node_id TEXT REFERENCES scene_node(id) ON DELETE CASCADE,
    pkey TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    hint TEXT, text TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    UNIQUE (scene_node_id, pkey)
  );
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, url TEXT NOT NULL, mime TEXT,
    width INTEGER, height INTEGER, duration_s INTEGER,
    has_alpha INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
    task_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gen_task (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    kind TEXT, title TEXT NOT NULL, sub TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','canceled')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    thumb TEXT, ref_id TEXT, media_id TEXT, error TEXT,
    model TEXT, prompt TEXT, ref_image_url TEXT, webhook TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS timeline (
    project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    tracks TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_brief_field_project ON brief_field(project_id, ord);
  CREATE INDEX IF NOT EXISTS idx_dialogue_project ON dialogue_message(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_scene_node_project ON scene_node(project_id, ord);
  CREATE INDEX IF NOT EXISTS idx_gen_task_project ON gen_task(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_media_project ON media(project_id);
  `);

  // 老库幂等列迁移：SQLite 没有 ADD COLUMN IF NOT EXISTS，自己查 pragma 决定
  ensureColumn(db, "generic_asset", "url",        "TEXT");
  ensureColumn(db, "generic_asset", "mime",       "TEXT");
  ensureColumn(db, "generic_asset", "size",       "INTEGER");
  ensureColumn(db, "generic_asset", "created_at", "TEXT NOT NULL DEFAULT ''");
}

function ensureColumn(db, table, col, decl) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!rows.length) return; // 表都没有就交给 CREATE TABLE
  if (rows.some(r => r.name === col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

// ===================================================================
// DAO —— 把行还原成前端期望的同构 JSON
// ===================================================================
export function makeDao(db) {
  const q = (sql) => db.prepare(sql);

  const getProject = (id) => {
    const p = q(`SELECT * FROM project WHERE id=?`).get(id);
    if (!p) return null;
    return { id: p.id, name: p.name, status: p.status,
      spec: { duration_s: p.duration_s, aspect: p.aspect, lang: p.lang, style: p.style },
      createdAt: p.created_at, updatedAt: p.updated_at };
  };

  const getBrief = (pid) => {
    const b = q(`SELECT * FROM brief WHERE project_id=?`).get(pid);
    if (!b) return null;
    const fields = q(`SELECT k,v,done FROM brief_field WHERE project_id=? ORDER BY ord`).all(pid)
      .map(f => ({ k: f.k, v: f.v, done: !!f.done }));
    return { projectId: pid, completeness: b.completeness, fields };
  };

  const getDialogue = (pid) =>
    q(`SELECT role,text,chips FROM dialogue_message WHERE project_id=? ORDER BY id`).all(pid)
      .map(m => ({ role: m.role, text: m.text, ...(JSON.parse(m.chips).length ? { chips: JSON.parse(m.chips) } : {}) }));

  const getScript = (pid) => {
    const g = q(`SELECT * FROM script WHERE project_id=?`).get(pid);
    if (!g) return null;
    const nodes = q(`SELECT * FROM scene_node WHERE project_id=? ORDER BY ord`).all(pid);
    const scenes = nodes.map(n => {
      const chars = q(`SELECT c.id,c.name FROM scene_node_char nc JOIN character c ON c.id=nc.character_id WHERE nc.scene_node_id=?`).all(n.id);
      return { id: n.id, order: n.ord, title: n.title, goal: n.goal,
        sceneRef: n.scene_ref, sceneRefId: n.scene_ref_id, chars,
        fx: { need: !!n.fx_need, type: n.fx_type, intensity: n.fx_intensity },
        narration: n.narration, kfState: n.kf_state, kf: n.kf };
    });
    return { projectId: pid, global: { scenes: g.total_scenes, duration_s: g.duration_s, style: g.style, bgm: g.bgm, narration: g.narration }, scenes };
  };

  const getCharacters = (pid) =>
    q(`SELECT * FROM character WHERE project_id=?`).all(pid)
      .map(c => ({ id: c.id, name: c.name, locked: !!c.locked, version: c.version, voice: c.voice, desc: c.descr, img: c.img }));

  const getScenes = (pid) =>
    q(`SELECT * FROM scene WHERE project_id=?`).all(pid)
      .map(s => ({ id: s.id, name: s.name, desc: s.descr, img: s.img }));

  const getGeneric = (pid) =>
    q(`SELECT * FROM generic_asset WHERE project_id=? ORDER BY created_at DESC`).all(pid)
      .map(a => ({ id: a.id, name: a.name, desc: a.descr, type: a.asset_type,
        url: a.url, mime: a.mime, size: a.size, createdAt: a.created_at }));

  const addGenericAsset = (pid, { name, desc, type, url, mime, size }) => {
    const id = uid("ga_");
    q(`INSERT INTO generic_asset(id,project_id,name,descr,asset_type,url,mime,size,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`).run(
      id, pid, String(name || "未命名素材"), String(desc || ""),
      String(type || "other"), url || null, mime || null,
      Number(size) || 0, now(),
    );
    return q(`SELECT * FROM generic_asset WHERE id=?`).get(id);
  };

  const deleteGenericAsset = (id) => {
    const row = q(`SELECT * FROM generic_asset WHERE id=?`).get(id);
    q(`DELETE FROM generic_asset WHERE id=?`).run(id);
    return row || null;
  };

  const taskRow = (t) => ({ id: t.id, projectId: t.project_id, kind: t.kind, title: t.title, sub: t.sub,
    status: t.status, progress: t.progress, thumb: t.thumb, refId: t.ref_id, mediaId: t.media_id, error: t.error });

  const getTasks = (pid, status) => {
    const rows = status
      ? q(`SELECT * FROM gen_task WHERE project_id=? AND status=? ORDER BY created_at`).all(pid, status)
      : q(`SELECT * FROM gen_task WHERE project_id=? ORDER BY created_at`).all(pid);
    return rows.map(taskRow);
  };
  const getTask = (id) => { const t = q(`SELECT * FROM gen_task WHERE id=?`).get(id); return t ? taskRow(t) : null; };

  const getTimeline = (pid) => {
    const tl = q(`SELECT * FROM timeline WHERE project_id=?`).get(pid);
    return tl ? { projectId: pid, tracks: JSON.parse(tl.tracks) } : null;
  };

  // ---- 项目 CRUD ----
  const listProjects = () =>
    q(`SELECT * FROM project ORDER BY updated_at DESC`).all().map(p => ({
      id: p.id, name: p.name, status: p.status,
      spec: { duration_s: p.duration_s, aspect: p.aspect, lang: p.lang, style: p.style },
      createdAt: p.created_at, updatedAt: p.updated_at,
    }));

  const createProject = ({ name, spec }) => {
    const id = uid("p_"), t = now();
    const s = spec || {};
    q(`INSERT INTO project(id,name,status,duration_s,aspect,lang,style,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`).run(
      id, name, "drafting",
      Number(s.duration_s) || 0,
      s.aspect || "16:9",
      s.lang || "zh",
      s.style || "",
      t, t,
    );
    q(`INSERT INTO brief(project_id,completeness) VALUES(?,0)`).run(id);
    const insBf = q(`INSERT INTO brief_field(project_id,k,v,done,ord) VALUES(?,?,?,0,?)`);
    BRIEF_TEMPLATE.forEach((k, i) => insBf.run(id, k, "", i));
    return getProject(id);
  };

  const updateProject = (id, patch) => {
    const cols = [], vals = [];
    const map = { name: "name", status: "status",
      duration_s: "duration_s", aspect: "aspect", lang: "lang", style: "style" };
    for (const [k, col] of Object.entries(map)) {
      const v = patch?.[k] ?? patch?.spec?.[k];
      if (v !== undefined) { cols.push(`${col}=?`); vals.push(v); }
    }
    if (!cols.length) return getProject(id);
    cols.push("updated_at=?"); vals.push(now()); vals.push(id);
    q(`UPDATE project SET ${cols.join(",")} WHERE id=?`).run(...vals);
    return getProject(id);
  };

  const deleteProject = (id) => {
    q(`DELETE FROM project WHERE id=?`).run(id);
  };

  // ---- brief 字段编辑（接受任意字段；未存在则新建） ----
  const patchBriefFields = (pid, fields) => {
    if (!fields) return getBrief(pid);
    const ord = q(`SELECT COALESCE(MAX(ord), -1) AS m FROM brief_field WHERE project_id=?`).get(pid).m;
    let nextOrd = ord + 1;
    const upd = q(`UPDATE brief_field SET v=?, done=? WHERE project_id=? AND k=?`);
    const ins = q(`INSERT INTO brief_field(project_id,k,v,done,ord) VALUES(?,?,?,?,?)`);
    for (const [k, raw] of Object.entries(fields)) {
      const v = raw == null ? "" : String(raw);
      const done = v.trim() ? 1 : 0;
      const r = upd.run(v, done, pid, k);
      if (r.changes === 0) ins.run(pid, k, v, done, nextOrd++);
    }
    const total = q(`SELECT COUNT(*) AS c FROM brief_field WHERE project_id=?`).get(pid).c;
    const done  = q(`SELECT COUNT(*) AS c FROM brief_field WHERE project_id=? AND done=1`).get(pid).c;
    const pct   = total ? Math.round(done * 100 / total) : 0;
    q(`UPDATE brief SET completeness=? WHERE project_id=?`).run(pct, pid);
    return getBrief(pid);
  };

  const deleteBriefField = (pid, k) => {
    q(`DELETE FROM brief_field WHERE project_id=? AND k=?`).run(pid, k);
    const total = q(`SELECT COUNT(*) AS c FROM brief_field WHERE project_id=?`).get(pid).c;
    const done  = q(`SELECT COUNT(*) AS c FROM brief_field WHERE project_id=? AND done=1`).get(pid).c;
    const pct   = total ? Math.round(done * 100 / total) : 0;
    q(`UPDATE brief SET completeness=? WHERE project_id=?`).run(pct, pid);
    return getBrief(pid);
  };

  // ---- 脚本写入（覆盖式：删旧再写） ----
  const saveScript = (pid, script) => {
    const g = script.global || {};
    q(`DELETE FROM scene_node_char WHERE scene_node_id IN (SELECT id FROM scene_node WHERE project_id=?)`).run(pid);
    q(`DELETE FROM prompt WHERE scene_node_id IN (SELECT id FROM scene_node WHERE project_id=?)`).run(pid);
    q(`DELETE FROM scene_node WHERE project_id=?`).run(pid);
    q(`DELETE FROM character WHERE project_id=?`).run(pid);
    q(`DELETE FROM scene WHERE project_id=?`).run(pid);
    q(`DELETE FROM script WHERE project_id=?`).run(pid);

    // 角色
    const insChar = q(`INSERT INTO character(id,project_id,name,locked,version,voice,descr,img)
                       VALUES(?,?,?,?,?,?,?,?)`);
    (script.characters || []).forEach(c => {
      const id = c.id || uid("c_");
      insChar.run(id, pid, c.name, 0, 1, c.voice || "", c.desc || c.descr || "", null);
      c.id = id;
    });

    // 场景
    const insScn = q(`INSERT INTO scene(id,project_id,name,descr,img) VALUES(?,?,?,?,?)`);
    (script.scenes_lib || script.scenesLib || []).forEach(s => {
      const id = s.id || uid("s_");
      insScn.run(id, pid, s.name, s.desc || s.descr || "", null);
      s.id = id;
    });

    // 全局脚本
    q(`INSERT INTO script(project_id,total_scenes,duration_s,style,bgm,narration)
       VALUES(?,?,?,?,?,?)`).run(
      pid,
      (script.scenes || []).length,
      Number(g.duration_s) || 0,
      g.style || "",
      g.bgm || "",
      g.narration || "",
    );

    // 分幕节点
    const insNode = q(`INSERT INTO scene_node(id,project_id,ord,title,goal,scene_ref_id,scene_ref,fx_need,fx_type,fx_intensity,narration,kf_state,kf)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insNC = q(`INSERT INTO scene_node_char(scene_node_id,character_id) VALUES(?,?)`);
    const insPrompt = q(`INSERT INTO prompt(scene_node_id,pkey,kind,label,hint,text)
                        VALUES(?,?,?,?,?,?)`);
    (script.scenes || []).forEach((n, i) => {
      const id = n.id || uid("sn_");
      const fx = n.fx || {};
      insNode.run(
        id, pid, Number(n.order) || (i + 1),
        n.title || `幕${i + 1}`,
        n.goal || "",
        n.sceneRefId || null,
        n.sceneRef || "",
        fx.need ? 1 : 0,
        fx.type || "",
        fx.intensity || null,
        n.narration || "",
        "pending",
        null,
      );
      (n.chars || []).forEach(ch => {
        if (ch && ch.id) insNC.run(id, ch.id);
      });
      // 写入 LLM 产出的个性化 prompt（每幕 char_<cid> / kf / fx）
      const ps = n.prompts || {};
      for (const [pkey, text] of Object.entries(ps)) {
        if (!text || typeof text !== "string" || !text.trim()) continue;
        const kind = pkey.startsWith("char_") ? "char_ref"
                   : pkey === "kf"            ? "keyframe"
                   : pkey === "fx"            ? "fx"
                   : "keyframe";
        const label = pkey.startsWith("char_")
          ? `角色参考图 · ${(n.chars || []).find(c => c.id === pkey.slice(5))?.name || ""}`.trim()
          : pkey === "kf" ? "分镜关键帧"
          : pkey === "fx" ? `动效 · ${fx.type || ""}`.trim()
          : pkey;
        const hint = pkey === "fx" ? `强度 ${fx.intensity || "中"}` : "";
        insPrompt.run(id, pkey, kind, label, hint, text.trim());
      }
      n.id = id;
    });

    q(`UPDATE project SET status=?, updated_at=? WHERE id=?`).run("scripting", now(), pid);
    return getScript(pid);
  };

  // ---- 写 ----
  const addDialogue = (pid, role, text, chips = []) => {
    q(`INSERT INTO dialogue_message(project_id,role,text,chips,created_at) VALUES(?,?,?,?,?)`)
      .run(pid, role, text, JSON.stringify(chips), now());
  };

  const upsertPrompt = (sceneNodeId, pkey, kind, label, hint, text) => {
    q(`INSERT INTO prompt(scene_node_id,pkey,kind,label,hint,text) VALUES(?,?,?,?,?,?)
       ON CONFLICT(scene_node_id,pkey) DO UPDATE SET text=excluded.text, version=prompt.version+1`)
      .run(sceneNodeId, pkey, kind, label || "", hint || null, text);
  };
  const getPrompts = (sceneNodeId) => {
    const rows = q(`SELECT pkey,kind,label,hint,text,version FROM prompt WHERE scene_node_id=? ORDER BY id`).all(sceneNodeId);
    return rows.map(r => ({ key: r.pkey, kind: r.kind, label: r.label, hint: r.hint || "", text: r.text, version: r.version }));
  };

  const lockCharacter = (id) => {
    q(`UPDATE character SET locked=1, version=version+1 WHERE id=?`).run(id);
    return q(`SELECT * FROM character WHERE id=?`).get(id);
  };

  const createTask = (pid, { kind, refId, model, prompt, refImageUrl, webhook }) => {
    const id = uid("g_"), t = now();
    const titleMap = { char_ref: "角色参考图", keyframe: "关键帧", fx: "动效", video: "视频片段", voice: "配音", bgm: "配乐" };
    q(`INSERT INTO gen_task(id,project_id,kind,title,sub,status,progress,ref_id,model,prompt,ref_image_url,webhook,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, pid, kind, `${titleMap[kind] || kind} 任务`, `${kind} · 已提交`, "queued", 0,
        refId || null, model || null, prompt || null, refImageUrl || null, webhook || null, t, t);
    return getTask(id);
  };

  const updateTask = (id, patch) => {
    const cols = [], vals = [];
    for (const [k, v] of Object.entries(patch)) { cols.push(`${k}=?`); vals.push(v); }
    cols.push("updated_at=?"); vals.push(now()); vals.push(id);
    q(`UPDATE gen_task SET ${cols.join(",")} WHERE id=?`).run(...vals);
    return getTask(id);
  };
  const rawTask = (id) => q(`SELECT * FROM gen_task WHERE id=?`).get(id);

  const addMedia = (pid, m) => {
    const id = m.id || uid("m_");
    q(`INSERT INTO media(id,project_id,kind,url,mime,width,height,duration_s,has_alpha,task_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, pid, m.kind, m.url, m.mime || null, m.width || null, m.height || null,
        m.duration_s || null, m.has_alpha ? 1 : 0, m.task_id || null, now());
    return id;
  };
  // 关键帧产物挂回对应幕
  const attachKeyframe = (sceneNodeId, url) =>
    q(`UPDATE scene_node SET kf_state='done', kf=? WHERE id=?`).run(url, sceneNodeId);
  // 角色参考图挂回角色
  const setCharacterImg = (charId, url) =>
    q(`UPDATE character SET img=? WHERE id=?`).run(url, charId);

  // 外部 Agent 直接交付的媒体产物：建一条 done 任务 + 写 media，并按 kind 绑定到分镜/角色。
  // 复用 queue 成功路径的落库形态，使 export / gen tasks 无需区分来源即可聚合。
  const ingestMedia = (pid, { kind, refId, url, mime, width, height, duration_s, has_alpha }) => {
    const task = createTask(pid, { kind, refId });
    const mediaId = addMedia(pid, { kind, task_id: task.id, url, mime, width, height, duration_s, has_alpha });
    const patch = { status: "done", progress: 100, media_id: mediaId };
    if (mime && mime.startsWith("image")) patch.thumb = url;
    updateTask(task.id, patch);
    if (kind === "keyframe" && refId) attachKeyframe(refId, url);
    if (kind === "char_ref" && refId) setCharacterImg(refId, url);
    return { taskId: task.id, mediaId, url };
  };

  const createExport = (pid) =>
    createTask(pid, { kind: "video", refId: null, model: "compose" });

  const touchProjectStatus = (pid, status) =>
    q(`UPDATE project SET status=?, updated_at=? WHERE id=?`).run(status, now(), pid);

  // 合并 brief patch：存在则更新 v 并置 done=1；不存在则忽略（系统种子已固定字段集）。
  // 返回更新后的 brief。
  const upsertBriefPatch = (pid, patch) => {
    const updField = q(`UPDATE brief_field SET v=?, done=1 WHERE project_id=? AND k=?`);
    let changed = 0;
    for (const [k, v] of Object.entries(patch || {})) {
      const r = updField.run(String(v), pid, k);
      if (r.changes > 0) changed++;
    }
    if (changed > 0) {
      const total = q(`SELECT COUNT(*) AS c FROM brief_field WHERE project_id=?`).get(pid).c;
      const done  = q(`SELECT COUNT(*) AS c FROM brief_field WHERE project_id=? AND done=1`).get(pid).c;
      const pct   = total ? Math.round(done * 100 / total) : 0;
      q(`UPDATE brief SET completeness=? WHERE project_id=?`).run(pct, pid);
    }
    return getBrief(pid);
  };

  // 把 chips 写到指定项目最近一条用户消息上（用于"卡片回执"）
  const tagLastUserMessage = (pid, chips) => {
    if (!chips?.length) return;
    const row = q(`SELECT id FROM dialogue_message WHERE project_id=? AND role='me' ORDER BY id DESC LIMIT 1`).get(pid);
    if (!row) return;
    q(`UPDATE dialogue_message SET chips=? WHERE id=?`).run(JSON.stringify(chips), row.id);
  };

  return {
    getProject, getBrief, getDialogue, getScript, getCharacters, getScenes, getGeneric,
    getTasks, getTask, getTimeline, addDialogue, upsertPrompt, getPrompts, lockCharacter,
    createTask, updateTask, rawTask, addMedia, attachKeyframe, setCharacterImg, ingestMedia,
    createExport, touchProjectStatus,
    upsertBriefPatch, tagLastUserMessage,
    listProjects, createProject, updateProject, deleteProject,
    patchBriefFields, saveScript,
    deleteBriefField,
    addGenericAsset, deleteGenericAsset,
  };
}
