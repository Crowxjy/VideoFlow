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

  gen submit                    按当前脚本提交全部生成任务 (char/key/fx/video)
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
async function genCmd(sub, args) {
  if (sub === "submit") {
    // 复用前端逻辑：拉脚本 → 汇总 items
    const script = await client.getScript();
    if (!script?.scenes?.length) return fail("脚本尚未生成，先 `videoflow script generate`", 1);
    const items = [];
    script.scenes.forEach(s => {
      (s.chars || []).forEach(c => items.push({ kind: "char_ref", refId: c.id }));
      items.push({ kind: "keyframe", refId: s.id });
      if (s.fx?.need) items.push({ kind: "fx", refId: s.id });
      items.push({ kind: "video", refId: s.id });
    });
    const r = await client.submitGen(items);
    out({ submitted: items.length, ...r }, () => console.log(`✓ 已提交 ${items.length} 项任务`));
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
