// ===================================================================
// AI 视频工作台 · 模型适配层 (Provider)
// -------------------------------------------------------------------
// 业务层只调用 provider.generate(kind, payload) -> { url, mime, ... }
//
// 支持的真实模型（其它 kind 调用会直接报错，不做静默回退）：
//   char_ref / keyframe -> OpenAI 文生图（默认 gpt-image-1）
//   video / fx          -> 字节火山方舟 Seedance（异步：创建->轮询->下载）
//   voice               -> 字节火山引擎 大模型 TTS（HTTP query 模式）
//
// 凭证存储 = data/settings.json（运行时可改，重启不丢）；env 仅作为首次启动的种子。
// 通过 `/v1/settings` HTTP 接口在页面内修改，无需重启服务。
// ===================================================================
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { Buffer } from "node:buffer";

const KIND_CN = { char_ref: "角色参考图", keyframe: "关键帧", fx: "动效", video: "视频片段", voice: "配音" };

// 默认配置 schema（值留空表示"未配置"）。每个真实通道至少有一个 required key。
const DEFAULT_SETTINGS = {
  openai: {
    apiKey:    process.env.OPENAI_API_KEY      || "",
    baseUrl:   process.env.OPENAI_BASE_URL     || "https://api.openai.com/v1",
    model:     process.env.OPENAI_IMAGE_MODEL  || "gpt-image-1",
    size:      process.env.OPENAI_IMAGE_SIZE   || "1536x1024",
  },
  ark: {
    apiKey:    process.env.ARK_API_KEY         || "",
    baseUrl:   process.env.ARK_BASE_URL        || "https://ark.cn-beijing.volces.com/api/v3",
    model:     process.env.ARK_VIDEO_MODEL     || "doubao-seedance-1-0-pro-250528",
    ratio:     process.env.ARK_VIDEO_RATIO     || "16:9",
    durationS: Number(process.env.ARK_VIDEO_DURATION || 5),
    publicBaseUrl: process.env.VF_PUBLIC_BASE_URL || "",
  },
  volcTts: {
    appId:      process.env.VOLC_TTS_APPID     || "",
    accessKey:  process.env.VOLC_TTS_TOKEN     || "",
    cluster:    process.env.VOLC_TTS_CLUSTER   || "volcano_tts",
    endpoint:   process.env.VOLC_TTS_ENDPOINT  || "https://openspeech.bytedance.com/api/v1/tts",
    voiceType:  process.env.VOLC_TTS_VOICE     || "BV700_streaming",
    speedRatio: Number(process.env.VOLC_TTS_SPEED || 1.0),
  },
  // 需求对话用的聊天模型（与图像/视频分离）
  chat: {
    provider:  process.env.VF_CHAT_PROVIDER    || "doubao",   // doubao | openai
    // 留空则复用 ark.apiKey / openai.apiKey，避免重复填
    apiKey:    process.env.VF_CHAT_API_KEY     || "",
    baseUrl:   process.env.VF_CHAT_BASE_URL    || "",
    model:     process.env.VF_CHAT_MODEL       || "doubao-1-5-pro-32k-250115",
    temperature: Number(process.env.VF_CHAT_TEMPERATURE || 0.4),
  },
};

// 哪些 kind 接入了真实模型，前端用此清单决定是否可用
const SUPPORTED_KINDS = ["char_ref", "keyframe", "video", "fx", "voice"];

// 字段元信息：用于前端渲染表单（label / 是否必填 / 是否敏感）
// 注：type === "enum" + options 走下拉；type === "enum-open" + options 走带候选项的可输入下拉（datalist）
const SETTINGS_SCHEMA = {
  openai: {
    label: "OpenAI · 文生图（char_ref / keyframe）",
    fields: [
      { key: "apiKey",  label: "API Key",   required: true,  secret: true },
      { key: "baseUrl", label: "Base URL",  required: false, secret: false, hint: "默认 https://api.openai.com/v1" },
      { key: "model",   label: "模型",      required: false, secret: false, type: "enum-open",
        options: [
          { value: "gpt-image-1", label: "gpt-image-1（推荐）" },
          { value: "dall-e-3",    label: "dall-e-3" },
          { value: "dall-e-2",    label: "dall-e-2" },
        ] },
      { key: "size",    label: "尺寸",      required: false, secret: false, type: "enum",
        options: [
          { value: "1024x1024", label: "1024 × 1024（方形）" },
          { value: "1024x1536", label: "1024 × 1536（竖向 2:3）" },
          { value: "1536x1024", label: "1536 × 1024（横向 3:2）" },
          { value: "1792x1024", label: "1792 × 1024（横向 16:9）" },
          { value: "1024x1792", label: "1024 × 1792（竖向 9:16）" },
        ] },
    ],
  },
  ark: {
    label: "火山方舟 Seedance · 视频（video / fx）",
    fields: [
      { key: "apiKey",        label: "API Key",          required: true,  secret: true },
      { key: "baseUrl",       label: "Base URL",         required: false, secret: false, hint: "默认 https://ark.cn-beijing.volces.com/api/v3" },
      { key: "model",         label: "模型",             required: false, secret: false, type: "enum-open",
        options: [
          { value: "doubao-seedance-1-0-pro-250528", label: "doubao-seedance-1-0-pro-250528（推荐）" },
          { value: "doubao-seedance-1-0-lite-i2v-250428", label: "doubao-seedance-1-0-lite-i2v-250428（图生视频）" },
          { value: "doubao-seedance-1-0-lite-t2v-250428", label: "doubao-seedance-1-0-lite-t2v-250428（文生视频）" },
        ] },
      { key: "ratio",         label: "画幅比例",         required: false, secret: false, type: "enum",
        options: [
          { value: "16:9", label: "16:9（横屏宽）" },
          { value: "9:16", label: "9:16（竖屏）" },
          { value: "1:1",  label: "1:1（方形）" },
          { value: "4:3",  label: "4:3" },
          { value: "3:4",  label: "3:4" },
          { value: "21:9", label: "21:9（电影超宽）" },
        ] },
      { key: "durationS",     label: "时长（秒）",       required: false, secret: false, type: "enum",
        options: [
          { value: 5,  label: "5 秒" },
          { value: 10, label: "10 秒" },
        ] },
      { key: "publicBaseUrl", label: "外网回调 Base URL", required: false, secret: false, hint: "图生视频时把 /media/* 暴露给模型侧" },
    ],
  },
  volcTts: {
    label: "火山引擎 TTS · 配音（voice）",
    fields: [
      { key: "appId",      label: "AppId",        required: true,  secret: false },
      { key: "accessKey",  label: "Access Token", required: true,  secret: true },
      { key: "cluster",    label: "Cluster",      required: false, secret: false, type: "enum-open",
        options: [
          { value: "volcano_tts", label: "volcano_tts（标准）" },
          { value: "volcano_icl", label: "volcano_icl（音色克隆）" },
        ] },
      { key: "endpoint",   label: "Endpoint",     required: false, secret: false, hint: "如 openspeech.bytedance.com" },
      { key: "voiceType",  label: "音色 ID",      required: false, secret: false, hint: "如 zh_female_qingxin / BV700" },
      { key: "speedRatio", label: "语速",         required: false, secret: false, type: "enum",
        options: [
          { value: 0.7, label: "0.7（慢）" },
          { value: 0.85, label: "0.85" },
          { value: 1.0,  label: "1.0（正常）" },
          { value: 1.15, label: "1.15" },
          { value: 1.3,  label: "1.3（快）" },
          { value: 1.5,  label: "1.5（很快）" },
        ] },
    ],
  },
  chat: {
    label: "需求对话 · Chat 模型",
    fields: [
      { key: "provider",    label: "厂商",       required: true,  secret: false, type: "enum",
        options: [
          { value: "doubao", label: "火山方舟 / 豆包（复用 ark.apiKey）" },
          { value: "openai", label: "OpenAI（复用 openai.apiKey）" },
        ] },
      { key: "model",       label: "模型",       required: true,  secret: false, type: "enum-open",
        options: [
          { value: "doubao-1-5-pro-32k-250115", label: "doubao-1-5-pro-32k-250115" },
          { value: "doubao-1-5-lite-32k-250115", label: "doubao-1-5-lite-32k-250115" },
          { value: "gpt-4o-mini", label: "gpt-4o-mini" },
          { value: "gpt-4o",      label: "gpt-4o" },
        ] },
      { key: "apiKey",      label: "API Key（可空，留空复用对应厂商组）", required: false, secret: true },
      { key: "baseUrl",     label: "Base URL（可空，留空复用对应厂商组）", required: false, secret: false },
      { key: "temperature", label: "Temperature", required: false, secret: false, type: "enum",
        options: [
          { value: 0,    label: "0（确定）" },
          { value: 0.3,  label: "0.3" },
          { value: 0.5,  label: "0.5" },
          { value: 0.7,  label: "0.7（推荐）" },
          { value: 1.0,  label: "1.0" },
          { value: 1.3,  label: "1.3（发散）" },
        ] },
    ],
  },
};

// ---------- 运行时设置（持久化到 data/settings.json） ----------
class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = this.load();
  }
  load() {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, "utf8"));
        return mergeDeep(structuredClone(DEFAULT_SETTINGS), raw);
      }
    } catch (e) {
      console.warn("[settings] 读取失败，使用默认值:", e.message);
    }
    return structuredClone(DEFAULT_SETTINGS);
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
  }
  get(group) { return this.data[group]; }
  update(group, patch) {
    if (!this.data[group]) throw new Error(`未知配置分组: ${group}`);
    this.data[group] = { ...this.data[group], ...patch };
    this.save();
    return this.data[group];
  }
  updateAll(patch) {
    for (const g of Object.keys(patch || {})) {
      if (this.data[g]) this.data[g] = { ...this.data[g], ...patch[g] };
    }
    this.save();
    return this.data;
  }
  // 给前端用的脱敏视图：secret 字段只返回是否已填，不回传原值
  publicView() {
    const out = {};
    for (const [group, fields] of Object.entries(SETTINGS_SCHEMA)) {
      out[group] = { label: fields.label, fields: [] };
      for (const f of fields.fields) {
        const v = this.data[group]?.[f.key];
        out[group].fields.push({
          ...f,
          value: f.secret ? "" : (v ?? ""),
          filled: !!(v !== undefined && v !== null && v !== ""),
        });
      }
    }
    return { groups: out, channelStatus: this.channelStatus(), supportedKinds: SUPPORTED_KINDS };
  }
  channelStatus() {
    const c = this.data;
    const chat = this.resolveChat();
    return {
      openai:  { ready: !!c.openai.apiKey,                        kinds: ["char_ref", "keyframe"] },
      ark:     { ready: !!c.ark.apiKey,                           kinds: ["video", "fx"] },
      volcTts: { ready: !!(c.volcTts.appId && c.volcTts.accessKey), kinds: ["voice"] },
      chat:    { ready: !!chat.apiKey && !!chat.model,            kinds: ["dialogue"] },
    };
  }
  // 把 chat 配置解析成最终生效的 { provider, apiKey, baseUrl, model, temperature }
  resolveChat() {
    const c = this.data.chat || {};
    const provider = c.provider || "doubao";
    const fallback = provider === "openai" ? this.data.openai : this.data.ark;
    const defaultBase = provider === "openai"
      ? (fallback?.baseUrl || "https://api.openai.com/v1")
      : (fallback?.baseUrl || "https://ark.cn-beijing.volces.com/api/v3");
    return {
      provider,
      apiKey:  c.apiKey  || fallback?.apiKey || "",
      baseUrl: c.baseUrl || defaultBase,
      model:   c.model   || "",
      temperature: Number(c.temperature ?? 0.4),
    };
  }
}
function mergeDeep(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) a[k] = mergeDeep(a[k] || {}, b[k]);
    else a[k] = b[k];
  }
  return a;
}

// ---------- 通用工具 ----------
function newMediaId() { return "media_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
async function saveBufferToMedia(dir, buf, ext) {
  const fname = `${newMediaId()}${ext.startsWith(".") ? ext : "." + ext}`;
  writeFileSync(join(dir, fname), buf);
  return `/media/${fname}`;
}
async function downloadUrlToMedia(dir, remoteUrl, fallbackExt) {
  const r = await fetch(remoteUrl);
  if (!r.ok) throw new Error(`下载产物失败 ${r.status}: ${remoteUrl}`);
  const buf = Buffer.from(await r.arrayBuffer());
  let ext = extname(new URL(remoteUrl).pathname);
  if (!ext) ext = fallbackExt;
  return saveBufferToMedia(dir, buf, ext);
}
function need(cond, msg) { if (!cond) throw new Error(msg); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function reqId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

function composeImagePrompt(p) {
  return [p.prompt, p.title, p.sub].filter(Boolean).join(" · ") || "cinematic, high quality";
}
function composeVideoPrompt(p, c) {
  return `${composeImagePrompt(p)} --rt ${c.ratio} --dur ${c.durationS}`;
}

// ---------- 本地占位 Provider：仅用于无 key 时跑通离线演示 ----------
const PALETTE = {
  char_ref: ["#7c6cff", "#5b8cff"], keyframe: ["#1c2030", "#7c6cff"],
  fx: ["#10331f", "#34d399"], video: ["#0e1118", "#5b8cff"],
  voice: ["#2a1c33", "#c084fc"], default: ["#1c2030", "#7c6cff"],
};
function svgPlaceholder({ kind, title, sub }) {
  const [c0, c1] = PALETTE[kind] || PALETTE.default;
  const safe = (s) => String(s || "").replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect x="40" y="40" width="1200" height="640" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.18"/>
  <text x="64" y="120" fill="#ffffff" font-family="sans-serif" font-size="30" opacity="0.7">${safe(KIND_CN[kind] || kind)}</text>
  <text x="64" y="380" fill="#ffffff" font-family="sans-serif" font-size="64" font-weight="700">${safe(title)}</text>
  <text x="64" y="440" fill="#ffffff" font-family="sans-serif" font-size="28" opacity="0.7">${safe(sub)}</text>
  <text x="64" y="660" fill="#ffffff" font-family="sans-serif" font-size="20" opacity="0.5">VideoFlow · 占位产物（VF_PROVIDER=local）</text>
</svg>`;
}
class LocalProvider {
  constructor(mediaDir) { this.dir = mediaDir; mkdirSync(mediaDir, { recursive: true }); }
  name() { return "local"; }
  async generate(kind, payload) {
    if (!KIND_CN[kind]) throw new Error(`未支持的素材类型: ${kind}`);
    const fname = `${newMediaId()}.svg`;
    writeFileSync(join(this.dir, fname),
      svgPlaceholder({ kind, title: payload.title || KIND_CN[kind], sub: payload.sub || (payload.prompt || "").slice(0, 40) }),
      "utf8");
    return {
      url: `/media/${fname}`, mime: "image/svg+xml", width: 1280, height: 720,
      duration_s: (kind === "video" || kind === "fx") ? (payload.duration_s || 6) : null,
      has_alpha: kind === "fx",
    };
  }
}

// ---------- 真实模型 Provider ----------
class RealProvider {
  constructor(mediaDir, settings) {
    this.dir = mediaDir;
    this.settings = settings;
    mkdirSync(mediaDir, { recursive: true });
  }
  name() { return "real"; }

  async generate(kind, payload) {
    switch (kind) {
      case "char_ref":
      case "keyframe":
        return this.genImageOpenAI(kind, payload);
      case "fx":
      case "video":
        return this.genVideoSeedance(kind, payload);
      case "voice":
        return this.genVoiceVolcTts(kind, payload);
      default:
        throw new Error(`素材类型「${kind}」未接入真实模型；当前 Real Provider 支持: ${SUPPORTED_KINDS.join(", ")}`);
    }
  }

  // ===== OpenAI 文生图 =====
  async genImageOpenAI(kind, payload) {
    const c = this.settings.get("openai");
    need(c.apiKey, "OpenAI 未配置：请在右上角「⚙ 设置」填入 API Key");
    const r = await fetch(`${c.baseUrl}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, prompt: composeImagePrompt(payload), size: c.size, n: 1 }),
    });
    if (!r.ok) throw new Error(`OpenAI 图像生成失败 ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const item = j?.data?.[0] || {};
    let url;
    if (item.b64_json) url = await saveBufferToMedia(this.dir, Buffer.from(item.b64_json, "base64"), ".png");
    else if (item.url) url = await downloadUrlToMedia(this.dir, item.url, ".png");
    else throw new Error("OpenAI 图像生成响应无 b64_json/url 字段");
    const [w, h] = String(c.size || "1536x1024").split("x").map(Number);
    return { url, mime: "image/png", width: w, height: h };
  }

  // ===== 火山方舟 Seedance 视频（异步） =====
  async genVideoSeedance(kind, payload) {
    const c = this.settings.get("ark");
    need(c.apiKey, "火山方舟未配置：请在右上角「⚙ 设置」填入 API Key");

    const content = [{ type: "text", text: composeVideoPrompt(payload, c) }];
    if (payload.refImageUrl) {
      const abs = toAbsoluteUrl(payload.refImageUrl, c.publicBaseUrl);
      content.push({ type: "image_url", image_url: { url: abs } });
    }

    const createRes = await fetch(`${c.baseUrl}/contents/generations/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, content }),
    });
    if (!createRes.ok) throw new Error(`Seedance 创建任务失败 ${createRes.status}: ${await createRes.text()}`);
    const { id: taskId } = await createRes.json();
    need(taskId, "Seedance 创建任务无 id 返回");

    const startedAt = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    while (true) {
      if (Date.now() - startedAt > timeoutMs) throw new Error(`Seedance 任务轮询超时: ${taskId}`);
      await sleep(4000);
      const pr = await fetch(`${c.baseUrl}/contents/generations/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${c.apiKey}` },
      });
      if (!pr.ok) throw new Error(`Seedance 轮询失败 ${pr.status}: ${await pr.text()}`);
      const pj = await pr.json();
      const status = pj.status || pj?.task?.status;
      if (status === "failed") throw new Error(`Seedance 任务失败: ${JSON.stringify(pj.error || pj)}`);
      if (status === "succeeded" || status === "success") {
        const videoUrl = pj?.content?.video_url || pj?.video_url;
        need(videoUrl, `Seedance 完成但无 video_url: ${JSON.stringify(pj)}`);
        const url = await downloadUrlToMedia(this.dir, videoUrl, ".mp4");
        return {
          url, mime: "video/mp4",
          duration_s: Number(c.durationS) || null,
          has_alpha: kind === "fx",
        };
      }
    }
  }

  // ===== 火山引擎 大模型 TTS =====
  async genVoiceVolcTts(kind, payload) {
    const c = this.settings.get("volcTts");
    need(c.appId && c.accessKey, "火山 TTS 未配置：请在右上角「⚙ 设置」填入 AppId + Access Token");
    const text = payload.text || payload.prompt || payload.sub || payload.title || "";
    need(text, "TTS 缺少文本内容");

    const body = {
      app:     { appid: c.appId, token: c.accessKey, cluster: c.cluster },
      user:    { uid: "videoflow" },
      audio:   { voice_type: c.voiceType, encoding: "mp3", speed_ratio: Number(c.speedRatio) || 1.0 },
      request: { reqid: reqId(), text, operation: "query" },
    };
    const r = await fetch(c.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer;${c.accessKey}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`火山 TTS 失败 ${r.status}: ${await r.text()}`);
    const j = await r.json();
    if (j.code !== undefined && j.code !== 3000)
      throw new Error(`火山 TTS 业务错误 code=${j.code} msg=${j.message || j.Message || ""}`);
    need(j.data, "火山 TTS 响应无 data(base64) 字段");
    const url = await saveBufferToMedia(this.dir, Buffer.from(j.data, "base64"), ".mp3");
    return { url, mime: "audio/mpeg",
      duration_s: j.addition?.duration ? Number(j.addition.duration) / 1000 : null };
  }
}

function toAbsoluteUrl(u, publicBaseUrl) {
  if (/^https?:\/\//i.test(u)) return u;
  if (!publicBaseUrl) throw new Error(`参考图是相对路径(${u})，请在「⚙ 设置 → 火山方舟」的「外网回调 Base URL」中填写公网可达地址`);
  return publicBaseUrl.replace(/\/$/, "") + u;
}

// ---------- 工厂 ----------
export function makeSettings(dataDir) {
  return new SettingsStore(join(dataDir, "settings.json"));
}
export function makeProvider(mediaDir, settings) {
  const mode = process.env.VF_PROVIDER || "local";
  if (mode === "real") return new RealProvider(mediaDir, settings);
  return new LocalProvider(mediaDir);
}

export { LocalProvider, RealProvider, SettingsStore, KIND_CN, SETTINGS_SCHEMA, SUPPORTED_KINDS };
