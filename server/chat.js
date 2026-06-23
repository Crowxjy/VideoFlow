// ===================================================================
// 需求对话 · ChatService
// -------------------------------------------------------------------
// 对外暴露两个能力：
//   1) streamReply(history, brief, onToken) -> fullText
//      调用兼容 OpenAI /chat/completions 接口（SSE 流式），逐 token 回调。
//   2) extractBriefPatch(history, brief, fullReply) -> { patch:{k:v}, chips:[] }
//      非流式调用一次，把已知信息抽成结构化 brief patch。
//
// doubao / openai 共用同一 OpenAI 兼容 API 形态，仅 baseUrl/model 不同。
// 火山方舟兼容端点：POST {baseUrl}/chat/completions
// ===================================================================

const SYSTEM_PROMPT_REPLY = `你是「VideoFlow」视频策划助手。用户正在和你梳理一支视频的拍摄需求。
你的任务：
- 用简短、专业、对话化的中文与用户交流，每次回复**不超过 80 字**；
- 围绕缺失字段持续追问，一次只问一个关键问题；
- 用户答完后先确认收到，再问下一个；
- 当所有字段都齐全时，主动提示"可以点右上角生成脚本"。
不要使用 Markdown 列表，保持自然语气。`;

const SYSTEM_PROMPT_EXTRACT = `你是信息抽取器。读完用户与助手的整段对话，把"需求单"字段更新到最新状态。
**只输出一个 JSON**（不要 Markdown / 注释 / 解释），形如：
{ "patch": { "字段名": "字段值", ... }, "chips": ["短卡片1","短卡片2"] }
规则：
- 字段名必须来自下方"已知字段列表"，不要新增；
- 没有新信息的字段不要写进 patch；
- patch 的 value 是字符串（多项用顿号或逗号合并）；
- chips 是给"刚刚发生的用户消息"加 1-2 张状态标签（≤8 个字），如「卖点 ×3 已记录」「画幅已确认」；若无可省略。`;

const SYSTEM_PROMPT_SCRIPT = `你是视频导演 + 资深分镜师。根据"需求单"产出一支可拍摄的脚本。
**只输出一个 JSON**（不要 Markdown / 注释 / 解释），格式严格如下：
{
  "global": { "duration_s": 数字(秒), "style": "整体风格描述", "bgm": "BGM 风格/描述", "narration": "整体旁白/口播主线" },
  "characters": [ { "id": "c_主角", "name": "角色名", "desc": "外貌/气质/穿着 一句话", "voice": "音色描述 一句话" } ],
  "scenes_lib": [ { "id": "s_场景key", "name": "场景名", "desc": "光线/环境/时间 一句话" } ],
  "scenes": [
    {
      "order": 1,
      "title": "幕名 (4-10 字)",
      "goal": "本幕要让观众感受到/理解的事情 一句话",
      "sceneRefId": "s_xxx",
      "sceneRef": "场景名",
      "chars": [ { "id": "c_xxx", "name": "角色名" } ],
      "fx": { "need": true/false, "type": "动效类型(粒子/转场/慢动作/...)，可空", "intensity": "low|mid|high|null" },
      "narration": "本幕旁白或台词 (≤30 字)",
      "prompts": {
        "char_<角色id>": "用于该角色在本幕中的参考图生成 prompt：外形+穿着+表情/动作+构图+灯光+画风，与本幕情境吻合，60-160 字",
        "kf": "本幕关键帧 prompt：场景+人物状态+构图+镜头景别+灯光+情绪基调+画风，能让文生图直接出图，60-180 字",
        "fx": "动效 prompt（仅 fx.need=true 时给出）：作用对象+动效类型+强度+时长+视觉特征+是否需要透明通道，40-120 字"
      }
    }
  ]
}
要求：
- 总时长贴近需求单"时长"字段；分幕 3-6 幕，每幕 6-20 秒；
- characters / scenes_lib 中 id 必须用 \`c_\` / \`s_\` 前缀，且能被 scenes[].chars[].id / scenes[].sceneRefId 引用；
- 每幕的 sceneRef 必须来自 scenes_lib；chars 必须来自 characters；
- fx.need=false 时 type/intensity 留空，prompts.fx 也省略；
- prompts 中的 char_<角色id> 必须为本幕 chars[].id 加 "char_" 前缀（例如本幕 chars 含 c_anna，则 key 为 char_c_anna）；
- 每条 prompt 都要结合本幕剧情个性化，不要写通用模板；
- 全部用中文；不要输出 JSON 以外的任何字符。`;

function briefForPrompt(brief) {
  if (!brief) return "(无)";
  return brief.fields.map(f => `- ${f.k}: ${f.v || "(未填)"}${f.done ? "" : "  ← 待完善"}`).join("\n");
}

function buildMessages(history, brief, systemPrompt, extra = "") {
  const msgs = [{ role: "system", content: systemPrompt + (extra ? "\n\n" + extra : "") }];
  // history: [{ role: 'ai' | 'me', text }]
  for (const m of history) {
    msgs.push({ role: m.role === "ai" ? "assistant" : "user", content: m.text });
  }
  return msgs;
}

// ---------- SSE 解析（OpenAI 兼容） ----------
async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf;
}

export class ChatService {
  constructor(settings) { this.settings = settings; }

  config() {
    const c = this.settings.resolveChat();
    if (!c.apiKey) throw new Error("AI 对话未配置：请在右上角「⚙ 设置 → 需求对话」中选好厂商并填好 API Key");
    if (!c.model)  throw new Error("AI 对话未配置：请在右上角「⚙ 设置 → 需求对话」中填好模型 ID");
    return c;
  }

  async streamReply(history, brief, onToken) {
    const c = this.config();
    const messages = buildMessages(history, brief, SYSTEM_PROMPT_REPLY,
      `当前需求单字段:\n${briefForPrompt(brief)}`);
    const r = await fetch(`${c.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, messages, temperature: c.temperature, stream: true }),
    });
    if (!r.ok || !r.body) throw new Error(`Chat 流式失败 ${r.status}: ${await safeText(r)}`);

    let full = "";
    for await (const line of sseLines(r)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") break;
      try {
        const j = JSON.parse(data);
        const delta = j?.choices?.[0]?.delta?.content || j?.choices?.[0]?.message?.content || "";
        if (delta) { full += delta; await onToken(delta); }
      } catch { /* 忽略心跳/异常行 */ }
    }
    return full;
  }

  async extractBriefPatch(history, brief, fullReply) {
    const c = this.config();
    const knownKeys = brief?.fields?.map(f => f.k) || [];
    const messages = buildMessages(history, brief, SYSTEM_PROMPT_EXTRACT,
      `已知字段列表（只允许使用这些 key）:\n${knownKeys.map(k => "- " + k).join("\n")}\n\n刚刚助手的最新回复（供你参考语境，不要重复总结它）:\n${fullReply}`);
    const r = await fetch(`${c.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        model: c.model, messages, temperature: 0.1,
        response_format: { type: "json_object" },  // OpenAI 兼容；doubao 也支持
      }),
    });
    if (!r.ok) return { patch: {}, chips: [] };
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "{}";
    try {
      const parsed = JSON.parse(content);
      const patch = {};
      for (const [k, v] of Object.entries(parsed.patch || {})) {
        if (knownKeys.includes(k) && typeof v === "string" && v.trim()) patch[k] = v.trim();
      }
      const chips = Array.isArray(parsed.chips) ? parsed.chips.filter(s => typeof s === "string").slice(0, 3) : [];
      return { patch, chips };
    } catch {
      return { patch: {}, chips: [] };
    }
  }

  async generateScript(brief, project) {
    const c = this.config();
    const projDur = Number(project?.spec?.duration_s) || 0;
    const aspect  = project?.spec?.aspect || "16:9";
    const userPrompt = `项目基础信息：
- 名称: ${project?.name || "(未命名)"}
- 画幅: ${aspect}
- 期望时长(秒): ${projDur || "见下方需求单"}

需求单（按字段列出）:
${briefForPrompt(brief)}

请据此输出 JSON 脚本。`;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT_SCRIPT },
      { role: "user",   content: userPrompt },
    ];
    const r = await fetch(`${c.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        model: c.model, messages, temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) throw new Error(`脚本生成失败 ${r.status}: ${await safeText(r)}`);
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "{}";
    let script;
    try { script = JSON.parse(content); }
    catch { throw new Error("脚本生成结果不是合法 JSON"); }
    if (!Array.isArray(script.scenes) || !script.scenes.length) {
      throw new Error("脚本生成结果缺少 scenes 数组");
    }
    return script;
  }
}

async function safeText(r) { try { return await r.text(); } catch { return ""; } }
