#!/usr/bin/env node
// ===================================================================
// videoflow-cli: 把 VideoFlow REST/SSE 后端包装成命令行工具，便于
// 第三方 Agent (Trae / Claude / 自研) 通过 spawn 直接调用。
//
// 全局参数：
//   --base=<url>      指定后端 (默认 http://localhost:8080/v1，env VIDEOFLOW_BASE)
//   --token=<tok>     Bearer 鉴权 (env VIDEOFLOW_TOKEN)
//   --project=<pid>   指定项目 (env VIDEOFLOW_PID 或 "use" 子命令记忆)
//   --json            纯 JSON 输出，便于 Agent 解析
//   --help            打印帮助
//
// 退出码：0 成功 / 1 业务错误 / 2 用法错误
// ===================================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import process from "node:process";
import { makeClient } from "./lib/client.js";
import {
  CHAT_REPLY_SYSTEM, CHAT_EXTRACT_SCHEMA, SCRIPT_SYSTEM,
  briefForPrompt, dialogueForPrompt,
} from "./lib/agent-prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
// 状态文件位置：env 优先 → ~/.videoflow-cli.json → 仓库 cli/ 目录（兜底沙箱场景）
const STATE_PATH = process.env.VIDEOFLOW_STATE
  || (() => { try { return join(homedir(), ".videoflow-cli.json"); } catch { return join(__dirname, ".state.json"); } })();

// ---------- 参数解析 ----------
function parseArgv(argv) {
  const flags = {}; const pos = [];
  for (const tok of argv) {
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq >= 0) flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      else flags[tok.slice(2)] = true;
    } else pos.push(tok);
  }
  return { flags, pos };
}

const { flags, pos } = parseArgv(process.argv.slice(2));
const JSON_OUT = !!flags.json;
const cmd = pos.shift();
const sub = pos.shift();

// ---------- 持久化记忆当前 project ----------
function loadState() {
  try { return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {}; } catch { return {}; }
}
function saveState(s) {
  try { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), "utf8"); } catch {}
}
const state = loadState();

// ---------- 客户端 ----------
const client = makeClient({
  base: flags.base,
  token: flags.token,
  projectId: flags.project || state.projectId,
});

// ---------- 输出 ----------
function out(data, hint) {
  if (JSON_OUT) { console.log(JSON.stringify(data, null, 2)); return; }
  if (typeof hint === "function") hint(data);
  else if (typeof data === "string") console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}
function fail(msg, code = 1) { console.error("✗ " + msg); process.exit(code); }

// 把 health.channelStatus 反转成 kind -> { ready, channel }，供 gen 命令判断通道就绪度
function kindReadiness(channelStatus = {}) {
  const map = {};
  for (const [channel, v] of Object.entries(channelStatus)) {
    for (const kind of v.kinds || []) map[kind] = { ready: !!v.ready, channel };
  }
  return map;
}

// ---------- 帮助 ----------
const HELP = `videoflow ${PKG.version} — VideoFlow CLI

用法:
  videoflow <命令> [子命令] [参数] [--global-flags]

全局参数:
  --base=<url>     后端 (默认 http://localhost:8080/v1, env VIDEOFLOW_BASE)
  --token=<tok>    Bearer Token (env VIDEOFLOW_TOKEN)
  --project=<pid>  项目 ID (覆盖记忆值, env VIDEOFLOW_PID)
  --json           JSON 输出 (Agent 友好)

命令:
  health                        探活 + 显示模型通道 ready 状态
  config show                   显示当前配置 (base/token/project)

  projects list                 列出所有项目
  projects create <name>        新建项目 [--aspect=16:9 --lang=zh]
  projects use <id>             记忆当前项目 (写入 ~/.videoflow-cli.json)
  projects show [<id>]          查看项目详情
  projects delete <id>          删除项目

  brief get                     拉取需求单
  brief set <key> <value>       设置一个字段 (会重算 completeness)
  brief delete <key>            删除字段

  chat send <text>              发送一条对话 (流式打印 AI 回复，含 brief 推断)
  chat history                  查看对话历史
  chat plan <text>              输出系统提示词 + brief + history，给 Agent 自带模型生成回复
  chat apply --from=<path>      把 Agent 生成的 {reply,patch,chips} 从文件读取并落库 (跳过后端 LLM)
  chat apply --reply=<inline>   或直接传 inline JSON 字符串

  script generate               让 LLM 生成完整脚本
  script show                   查看当前脚本
  script plan                   输出系统提示词 + brief + characters，给 Agent 自带模型生成脚本
  script apply --from=<path>    把 Agent 生成的脚本 JSON 从文件读取并写入项目 (跳过后端 LLM)

  characters list               列出角色
  scenes list                   列出分幕
  generic list                  列出通用素材
  generic upload <file>         上传素材 [--name=.. --type=.. --desc=..]
  generic delete <id>           删除通用素材

  gen submit                    按当前脚本提交生成任务 (自动跳过已交付/未就绪通道)
                                [--kinds=keyframe,voice 白名单] [--force 不跳过未就绪通道]
  gen chain                     顺序衔接生成: 按幕序串行生成视频, 上一幕尾帧作下一幕首帧
                                (本幕关键帧仍作参考; 需 ark 通道 + Seedance 2.0 系列) [--force]
  gen plan                      输出每幕可生成的媒体清单+prompt+通道就绪度，交宿主 Agent 自产
  gen ingest --from=<manifest>  把宿主 Agent 产出的媒体文件上传并绑定到分镜/角色
  gen tasks [--status=done]     列出生成任务
  gen task <id>                 查询单个任务
  gen retry <id>                重试失败任务
  gen cancel <id>               取消排队/运行中任务

  export                        导出剪辑清单 JSON 到 stdout

  settings get                  查看模型设置 (脱敏)
  settings set <group.key> <v>  设置一项, 例: settings set openai.apiKey sk-...

示例 (Agent 调用):
  videoflow projects create "新春广告" --json
  videoflow projects use p_abc123
  videoflow chat send "30秒，目标人群Z世代" --json
  videoflow script generate --json
  videoflow gen submit --json
  videoflow gen tasks --status=done --json
  videoflow export > cut-manifest.json
`;

if (!cmd || cmd === "help" || flags.help) { console.log(HELP); process.exit(0); }
if (cmd === "version" || flags.version) { console.log(PKG.version); process.exit(0); }

// ---------- 命令分发 ----------
try {
  await dispatch(cmd, sub, pos);
} catch (e) {
  if (JSON_OUT) console.error(JSON.stringify({ error: true, message: e.message, status: e.status, body: e.body }));
  else fail(e.message);
  process.exit(1);
}

async function dispatch(cmd, sub, args) {
  switch (cmd) {
    case "health": {
      const s = await client.health();
      out({ ok: true, channels: s.channelStatus, supportedKinds: s.supportedKinds },
          (d) => {
            console.log("✓ VideoFlow OK   base =", client.config().base);
            console.log("  通道:");
            for (const [k, v] of Object.entries(d.channels || {}))
              console.log(`    ${k.padEnd(8)} ${v.ready ? "✓ 已配置" : "✗ 未配置"}  kinds=[${(v.kinds||[]).join(",")}]`);
          });
      return;
    }
    case "config": {
      if (sub === "show" || !sub) {
        const cfg = client.config();
        out({ ...cfg, projectId: cfg.projectId || null, savedProjectId: state.projectId || null });
        return;
      }
      return fail(`未知 config 子命令: ${sub}`, 2);
    }

    case "projects": return projectsCmd(sub, args);
    case "brief":    return briefCmd(sub, args);
    case "chat":     return chatCmd(sub, args);
    case "script":   return scriptCmd(sub, args);
    case "characters": return listCmd(sub, () => client.getCharacters(), "characters");
    case "scenes":     return listCmd(sub, () => client.getScenes(),     "scenes");
    case "generic":  return genericCmd(sub, args);
    case "gen":      return genCmd(sub, args);
    case "export": {
      // 与前端 app.js exportFilm() 一致：聚合 script + tasks 拼剪辑清单 manifest
      const [proj, script, tasksRes] = await Promise.all([
        client.getProject(),
        client.getScript().catch(() => null),
        client.listTasks(),
      ]);
      const tasks = tasksRes.items || tasksRes;
      const taskByRef = {};
      tasks.forEach(t => { if (t.refId) (taskByRef[t.refId] ||= []).push(t); });
      const cuts = (script?.scenes || []).map(s => ({
        order: s.order, title: s.title, sceneRefId: s.sceneRefId, sceneRef: s.sceneRef,
        narration: s.narration, keyframe: s.kf || null,
        assets: (taskByRef[s.id] || []).filter(t => t.status === "done").map(t => ({ kind: t.kind, mediaId: t.mediaId })),
      }));
      const manifest = {
        project: proj, global: script?.global || null, cuts,
        exportedAt: new Date().toISOString(),
      };
      out(manifest);
      return;
    }
    case "settings": return settingsCmd(sub, args);

    default: return fail(`未知命令: ${cmd}\n  videoflow help`, 2);
  }
}

// ---------- projects ----------
async function projectsCmd(sub, args) {
  switch (sub) {
    case "list": case undefined: {
      const r = await client.listProjects();
      const items = r.items || r;
      out({ items },
          () => items.forEach(p => console.log(`  ${p.id}\t${p.name}`)));
      return;
    }
    case "create": {
      const name = args[0];
      if (!name) return fail("用法: videoflow projects create <name>", 2);
      const p = await client.createProject({ name, aspect: flags.aspect, lang: flags.lang });
      // 自动记忆
      state.projectId = p.id; saveState(state); client.setPid(p.id);
      out(p, () => console.log(`✓ 已创建 ${p.id}  ${p.name}  (已设为当前项目)`));
      return;
    }
    case "use": {
      const id = args[0];
      if (!id) return fail("用法: videoflow projects use <id>", 2);
      state.projectId = id; saveState(state); client.setPid(id);
      out({ projectId: id }, () => console.log(`✓ 当前项目 = ${id}`));
      return;
    }
    case "show": {
      const id = args[0] || state.projectId;
      if (!id) return fail("缺少项目 ID", 2);
      out(await client.getProject(id));
      return;
    }
    case "delete": {
      const id = args[0];
      if (!id) return fail("用法: videoflow projects delete <id>", 2);
      await client.deleteProject(id);
      if (state.projectId === id) { delete state.projectId; saveState(state); }
      out({ ok: true, deleted: id }, () => console.log(`✓ 已删除 ${id}`));
      return;
    }
    default: return fail(`未知 projects 子命令: ${sub}`, 2);
  }
}

// ---------- brief ----------
async function briefCmd(sub, args) {
  if (sub === "get" || !sub) {
    const b = await client.getBrief();
    out(b, (d) => {
      console.log(`需求单 (完成度 ${d.completeness}%):`);
      d.fields.forEach(f =>
        console.log(`  ${f.done ? "✓" : "·"} ${f.k.padEnd(14)} ${f.v || "—"}`));
    });
    return;
  }
  if (sub === "set") {
    const [k, ...rest] = args;
    if (!k) return fail("用法: videoflow brief set <key> <value>", 2);
    const v = rest.join(" ");
    out(await client.patchBrief({ [k]: v }),
        () => console.log(`✓ ${k} = ${v || "(空)"}`));
    return;
  }
  if (sub === "delete") {
    const k = args[0];
    if (!k) return fail("用法: videoflow brief delete <key>", 2);
    out(await client.deleteBriefField(k), () => console.log(`✓ 已删除字段 ${k}`));
    return;
  }
  return fail(`未知 brief 子命令: ${sub}`, 2);
}

// ---------- chat ----------
async function chatCmd(sub, args) {
  if (sub === "send") {
    const text = args.join(" ").trim();
    if (!text) return fail("用法: videoflow chat send <text>", 2);
    let briefPayload = null;
    const result = await client.sendMessage(text, {
      onToken: (delta) => {
        if (!JSON_OUT) process.stdout.write(delta);
      },
      onBrief: (p) => { briefPayload = p; },
    });
    if (JSON_OUT) {
      out({ reply: result.reply, brief: briefPayload?.brief, chips: result.chips, patch: briefPayload?.patch });
    } else {
      process.stdout.write("\n");
      if (result.chips?.length) console.log("\n候选：" + result.chips.join(" / "));
      if (briefPayload?.brief) console.log(`\n需求单完成度 → ${briefPayload.brief.completeness}%`);
    }
    return;
  }
  if (sub === "history") {
    out(await client.getDialogue());
    return;
  }
  // chat plan <text>: 不调后端 LLM，输出 prompt + 上下文，Agent 自带模型来生成
  if (sub === "plan") {
    const text = args.join(" ").trim();
    if (!text) return fail("用法: videoflow chat plan <text>", 2);
    const [brief, history] = await Promise.all([
      client.getBrief(),
      client.getDialogue(),
    ]);
    const knownKeys = (brief?.fields || []).map(f => f.k);
    const userPrompt = `当前需求单字段：
${briefForPrompt(brief)}

最近对话：
${dialogueForPrompt(history)}

刚刚用户的新消息：
${text}

请基于已知字段列表生成 reply / patch / chips。已知字段列表（patch 只允许使用这些 key）：
${knownKeys.map(k => "- " + k).join("\n")}`;
    out({
      mode: "chat.plan",
      system: CHAT_REPLY_SYSTEM + "\n\n" + CHAT_EXTRACT_SCHEMA,
      user: userPrompt,
      schema: { reply: "string", patch: "object<string,string>", chips: "string[]" },
      brief, history, knownKeys, userText: text,
    });
    return;
  }
  // chat apply --from=<path> 或 --reply=<inline-json>: 把 Agent 产物落库
  if (sub === "apply") {
    const fromFile = flags.from;
    const inline = flags.reply || args[0];
    let parsed;
    try {
      if (fromFile) parsed = JSON.parse(readFileSync(fromFile, "utf8"));
      else if (inline) parsed = JSON.parse(inline);
      else return fail("用法: videoflow chat apply --from=<path> 或 --reply='{\"reply\":\"...\",\"patch\":{...},\"chips\":[...]}'", 2);
    } catch (e) {
      return fail(`解析 reply JSON 失败: ${e.message}`, 2);
    }
    const userText = (flags.user || parsed.user || "").toString();
    const reply = (parsed.reply || "").toString();
    const chips = Array.isArray(parsed.chips) ? parsed.chips : [];
    const patch = parsed.patch && typeof parsed.patch === "object" ? parsed.patch : {};
    let briefAfter = null;
    if (Object.keys(patch).length) briefAfter = await client.patchBrief(patch);
    const dlg = await client.putDialogue({ user: userText, reply, chips });
    out({ ok: true, brief: briefAfter, ...dlg },
        () => console.log(`✓ 已落库  reply=${reply.slice(0, 24)}…  patch=${Object.keys(patch).length} 字段  chips=${chips.length}`));
    return;
  }
  return fail(`未知 chat 子命令: ${sub}`, 2);
}

// ---------- script ----------
async function scriptCmd(sub, args) {
  if (sub === "generate") {
    const r = await client.generateScript();
    out(r, () => console.log(`✓ 脚本已生成: ${r?.scenes?.length || 0} 幕`));
    return;
  }
  if (sub === "show" || !sub) {
    out(await client.getScript());
    return;
  }
  // script plan: 输出 prompt + brief + characters，让 Agent 自带模型生成完整脚本 JSON
  if (sub === "plan") {
    const [proj, brief, characters] = await Promise.all([
      client.getProject(),
      client.getBrief(),
      client.getCharacters().catch(() => []),
    ]);
    const projDur = Number(proj?.spec?.duration_s) || 0;
    const aspect  = proj?.spec?.aspect || "16:9";
    const userPrompt = `项目基础信息：
- 名称: ${proj?.name || "(未命名)"}
- 画幅: ${aspect}
- 期望时长(秒): ${projDur || "见下方需求单"}

需求单（按字段列出）:
${briefForPrompt(brief)}

请据此输出 JSON 脚本。`;
    out({
      mode: "script.plan",
      system: SCRIPT_SYSTEM,
      user: userPrompt,
      schema: "见 system 中的 JSON 模板",
      project: proj, brief, characters,
    });
    return;
  }
  // script apply --from=<path>: 把 Agent 生成的脚本 JSON 直接写入项目
  if (sub === "apply") {
    const fromFile = flags.from;
    const inline = args[0];
    let script;
    try {
      if (fromFile) script = JSON.parse(readFileSync(fromFile, "utf8"));
      else if (inline) script = JSON.parse(inline);
      else return fail("用法: videoflow script apply --from=<path>  (也可直接传 inline JSON 字符串)", 2);
    } catch (e) {
      return fail(`解析脚本 JSON 失败: ${e.message}`, 2);
    }
    if (!script || typeof script !== "object" || !Array.isArray(script.scenes)) {
      return fail("脚本 JSON 缺少 scenes 数组", 2);
    }
    const saved = await client.putScript(script);
    out(saved, () => console.log(`✓ 脚本已写入: ${saved?.scenes?.length || 0} 幕`));
    return;
  }
  return fail(`未知 script 子命令: ${sub}`, 2);
}

// ---------- 通用列表 ----------
async function listCmd(sub, getter, label) {
  if (sub && sub !== "list") return fail(`未知 ${label} 子命令: ${sub}`, 2);
  out(await getter());
}

// ---------- generic 素材 ----------
async function genericCmd(sub, args) {
  if (sub === "list" || !sub) { out(await client.getGeneric()); return; }
  if (sub === "upload") {
    const fp = args[0];
    if (!fp) return fail("用法: videoflow generic upload <file>", 2);
    const abs = resolve(process.cwd(), fp);
    if (!existsSync(abs)) return fail(`文件不存在: ${abs}`, 2);
    const r = await client.uploadGenericAsset(abs, {
      name: flags.name, type: flags.type, desc: flags.desc,
    });
    out(r, () => console.log(`✓ 上传成功 mediaId=${r.mediaId || r.id || "?"}`));
    return;
  }
  if (sub === "delete") {
    const id = args[0];
    if (!id) return fail("用法: videoflow generic delete <id>", 2);
    out(await client.deleteGenericAsset(id), () => console.log(`✓ 已删除 ${id}`));
    return;
  }
  return fail(`未知 generic 子命令: ${sub}`, 2);
}

// ---------- gen 任务 ----------
// 依据脚本推导出「本应生成」的媒体清单：每个 char_ref/keyframe/fx/video/voice 及其 refId
function deriveGenItems(script) {
  const items = [];
  (script.scenes || []).forEach(s => {
    (s.chars || []).forEach(c => items.push({ kind: "char_ref", refId: c.id, sceneId: s.id, name: c.name }));
    items.push({ kind: "keyframe", refId: s.id, sceneId: s.id, title: s.title });
    if (s.fx?.need) items.push({ kind: "fx", refId: s.id, sceneId: s.id, title: s.title });
    items.push({ kind: "video", refId: s.id, sceneId: s.id, title: s.title });
    if (s.narration) items.push({ kind: "voice", refId: s.id, sceneId: s.id, title: s.title });
  });
  return items;
}

async function genCmd(sub, args) {
  if (sub === "submit") {
    const script = await client.getScript();
    if (!script?.scenes?.length) return fail("脚本尚未生成，先 `videoflow script generate` 或 `videoflow script apply`", 1);
    const readiness = kindReadiness((await client.health()).channelStatus);
    // 已交付：已有 done media 的 (kind, refId) 不再重复提交（宿主 ingest 或后端上一轮已产出）
    const doneRes = await client.listTasks("done");
    const doneTasks = (doneRes.items || doneRes || []).filter(t => t.refId);
    const doneSet = new Set(doneTasks.map(t => `${t.kind}:${t.refId}`));
    const whitelist = flags.kinds ? new Set(String(flags.kinds).split(",").map(s => s.trim()).filter(Boolean)) : null;

    const all = deriveGenItems(script);
    const submit = [], skipped = [];
    for (const it of all) {
      if (whitelist && !whitelist.has(it.kind)) { skipped.push({ ...it, reason: "not-in-kinds" }); continue; }
      if (doneSet.has(`${it.kind}:${it.refId}`)) { skipped.push({ ...it, reason: "already-done" }); continue; }
      const ready = readiness[it.kind]?.ready;
      if (!ready && !flags.force) { skipped.push({ ...it, reason: `channel-not-ready(${readiness[it.kind]?.channel || "?"})` }); continue; }
      submit.push({ kind: it.kind, refId: it.refId });
    }
    let created = [];
    if (submit.length) {
      const r = await client.submitGen(submit);
      created = Array.isArray(r) ? r : (r.items || r.created || []);
    }
    out({ submitted: submit.length, skipped: skipped.length, created, skippedDetail: skipped },
        () => {
          console.log(`✓ 已提交 ${submit.length} 项，跳过 ${skipped.length} 项`);
          const byReason = skipped.reduce((m, s) => (m[s.reason] = (m[s.reason] || 0) + 1, m), {});
          for (const [r, n] of Object.entries(byReason)) console.log(`  · ${r}: ${n}`);
        });
    return;
  }
  // gen plan: 输出每幕媒体清单 + 已存 prompt + 通道就绪度，交宿主 Agent 自产
  if (sub === "plan") {
    const script = await client.getScript();
    if (!script?.scenes?.length) return fail("脚本尚未生成，先 `videoflow script generate` 或 `videoflow script apply`", 1);
    const readiness = kindReadiness((await client.health()).channelStatus);
    const doneRes = await client.listTasks("done");
    const doneTasks = (doneRes.items || doneRes || []).filter(t => t.refId);
    const doneSet = new Set(doneTasks.map(t => `${t.kind}:${t.refId}`));
    // 每幕的 prompts（char_/kf/fx 已在脚本生成时落库；voice 用旁白文本）
    const promptsByScene = {};
    await Promise.all((script.scenes || []).map(async s => {
      promptsByScene[s.id] = await client.getScenePrompts(s.id).catch(() => []);
    }));
    const items = deriveGenItems(script).map(it => {
      const ps = promptsByScene[it.sceneId] || [];
      let prompt = "";
      if (it.kind === "char_ref") prompt = ps.find(p => p.key === `char_${it.refId}`)?.text || "";
      else if (it.kind === "keyframe") prompt = ps.find(p => p.key === "kf")?.text || "";
      else if (it.kind === "fx") prompt = ps.find(p => p.key === "fx")?.text || "";
      else if (it.kind === "voice") prompt = (script.scenes.find(s => s.id === it.sceneId)?.narration) || "";
      // video 无独立 prompt，复用 keyframe 语义
      else if (it.kind === "video") prompt = ps.find(p => p.key === "kf")?.text || "";
      return {
        kind: it.kind, refId: it.refId, sceneId: it.sceneId,
        label: it.name || it.title || "",
        prompt,
        backendReady: !!readiness[it.kind]?.ready,
        backendChannel: readiness[it.kind]?.channel || null,
        alreadyDone: doneSet.has(`${it.kind}:${it.refId}`),
      };
    }).filter(it => !it.alreadyDone);
    out({
      mode: "gen.plan",
      note: "宿主 Agent 若具备对应能力，请生成媒体文件后用 `gen ingest --from=<manifest>` 回写；" +
            "无力生成的项，通道 backendReady=true 时可交后端 `gen submit`。",
      channelStatus: readiness,
      items,
    });
    return;
  }
  // gen ingest --from=<manifest.json>: 把宿主产出的媒体文件逐条上传绑定
  // manifest: { items: [ { kind, refId, file, width?, height?, durationS?, hasAlpha? } ] }
  if (sub === "ingest") {
    const src = flags.from || args[0];
    if (!src) return fail("用法: videoflow gen ingest --from=<manifest.json>", 2);
    let manifest;
    try { manifest = JSON.parse(readFileSync(src, "utf8")); }
    catch (e) { return fail(`解析 manifest 失败: ${e.message}`, 2); }
    const list = Array.isArray(manifest) ? manifest : (manifest.items || []);
    if (!list.length) return fail("manifest 里没有 items", 2);
    const results = [];
    for (const it of list) {
      if (!it.kind || !it.file) { results.push({ ...it, ok: false, error: "缺少 kind 或 file" }); continue; }
      const abs = resolve(process.cwd(), it.file);
      if (!existsSync(abs)) { results.push({ ...it, ok: false, error: `文件不存在: ${abs}` }); continue; }
      try {
        const r = await client.ingestMedia(abs, {
          kind: it.kind, refId: it.refId,
          width: it.width, height: it.height, durationS: it.durationS, hasAlpha: it.hasAlpha,
        });
        results.push({ kind: it.kind, refId: it.refId, ok: true, mediaId: r.mediaId, url: r.url });
      } catch (e) {
        results.push({ kind: it.kind, refId: it.refId, ok: false, error: e.message });
      }
    }
    const okN = results.filter(r => r.ok).length;
    out({ ingested: okN, failed: results.length - okN, results },
        () => {
          console.log(`✓ 交付 ${okN} 项，失败 ${results.length - okN} 项`);
          results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.kind} ${r.refId || ""}: ${r.error}`));
        });
    return;
  }
  // gen chain: 顺序衔接生成——按幕序串行生成视频，上一幕视频尾帧作下一幕首帧（本幕关键帧仍作参考）
  // 依赖后端 ark 通道 + Seedance 2.0 系列模型（多模态参考生视频）。
  if (sub === "chain") {
    const script = await client.getScript();
    if (!script?.scenes?.length) return fail("脚本尚未生成，先 `videoflow script generate` 或 `videoflow script apply`", 1);
    const readiness = kindReadiness((await client.health()).channelStatus);
    if (!readiness.video?.ready && !flags.force) {
      return fail(`视频通道(${readiness.video?.channel || "ark"})未就绪；配置火山方舟后重试，或加 --force 强行提交`, 1);
    }
    // 按幕序排序，逐幕提交为链路任务
    const scenes = (script.scenes || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const items = scenes.map(s => ({ kind: "video", refId: s.id }));
    const r = await client.submitChain(items);
    const created = Array.isArray(r) ? r : (r.items || r.created || []);
    out({ submitted: items.length, mode: "gen.chain", created },
        () => {
          console.log(`✓ 已提交 ${items.length} 幕顺序衔接任务（串行生成，首帧衔接）`);
          console.log(`  用 \`videoflow gen tasks --json\` 轮询进度`);
        });
    return;
  }
  if (sub === "tasks" || !sub) {
    out(await client.listTasks(flags.status),
        (d) => {
          const arr = d.items || d;
          arr.forEach(t => console.log(
            `  ${t.id?.padEnd(20)} ${t.kind?.padEnd(10)} ${t.status?.padEnd(8)} ` +
            `${t.progress ?? 0}%  ${t.mediaId || ""}`));
        });
    return;
  }
  if (sub === "task") {
    const id = args[0]; if (!id) return fail("用法: videoflow gen task <id>", 2);
    out(await client.pollTask(id));
    return;
  }
  if (sub === "retry") {
    const id = args[0]; if (!id) return fail("用法: videoflow gen retry <id>", 2);
    out(await client.retryTask(id), () => console.log(`✓ 已重试 ${id}`));
    return;
  }
  if (sub === "cancel") {
    const id = args[0]; if (!id) return fail("用法: videoflow gen cancel <id>", 2);
    out(await client.cancelTask(id), () => console.log(`✓ 已取消 ${id}`));
    return;
  }
  return fail(`未知 gen 子命令: ${sub}`, 2);
}

// ---------- settings ----------
async function settingsCmd(sub, args) {
  if (sub === "get" || !sub) {
    out(await client.getSettings());
    return;
  }
  if (sub === "set") {
    const [path, ...rest] = args;
    if (!path || !path.includes(".")) return fail("用法: videoflow settings set <group.key> <value>", 2);
    const [group, key] = path.split(".");
    const value = rest.join(" ");
    const r = await client.saveSettings({ [group]: { [key]: value } });
    out(r, () => console.log(`✓ ${group}.${key} 已更新`));
    return;
  }
  return fail(`未知 settings 子命令: ${sub}`, 2);
}
