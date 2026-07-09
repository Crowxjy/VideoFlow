/* ============ AI 视频工作台 · 应用逻辑 ============
 * 单一数据源：始终通过 api.js 走后端 /v1。
 * 顶部支持项目选择 / 新建 / 重命名 / 删除；无项目时强制引导新建。
 * ====================================================== */
const ICON = {
  brief: '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  script: '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
  gen: '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-7.07-2.83 2.83M9.76 14.24l-2.83 2.83m0-12.14 2.83 2.83m4.48 4.48 2.83 2.83"/></svg>',
  edit: '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h20M2 16h20M8 4v16M16 4v16"/></svg>',
  asset: '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m12 2 9 5-9 5-9-5z"/><path d="M12 12v10"/></svg>',
  user: '<svg class="ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  scene: '<svg class="ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="8" cy="9" r="1.4"/></svg>',
  spark: '<svg class="ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4m0 10v4M5 12H1m22 0h-4"/><path d="M12 7a5 5 0 0 0 5 5 5 5 0 0 0-5 5 5 5 0 0 0-5-5 5 5 0 0 0 5-5z"/></svg>',
  wand: '<svg class="ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2m0 20v-2M9 9l11 11M4 7h2m12 0h2M7 4 4 7"/><path d="m14 8 6-6"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m6 4 14 8-14 8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
  clip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.49-8.49a4 4 0 0 1 5.66 5.66l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  circle: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/></svg>',
  img: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
  film: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5m10 0h5M2 16h5m10 0h5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.42.18.78.5 1.04.88.26.39.4.84.4 1.3v.02c0 .46-.14.91-.4 1.3-.26.38-.62.7-1.04.88z"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
};

const STEPS = [
  { id: "brief", no: "01", label: "需求对话", icon: ICON.brief },
  { id: "script", no: "02", label: "脚本故事板", icon: ICON.script },
  { id: "gen", no: "03", label: "素材生成", icon: ICON.gen },
  { id: "editor", no: "04", label: "剪辑成片", icon: ICON.edit },
];

let CURRENT = "brief";

// 逐镜参数可选项（与后端 SETTINGS_SCHEMA 对齐）；空值表示「跟随全局默认」。
const SCENE_PARAM_OPTS = {
  imgSize: [
    { value: "", label: "跟随全局默认" },
    { value: "1024x1024", label: "1024×1024（方形）" },
    { value: "1024x1536", label: "1024×1536（竖 2:3）" },
    { value: "1536x1024", label: "1536×1024（横 3:2）" },
    { value: "1792x1024", label: "1792×1024（横 16:9）" },
    { value: "1024x1792", label: "1024×1792（竖 9:16）" },
  ],
  videoRatio: [
    { value: "", label: "跟随全局默认" },
    { value: "adaptive", label: "adaptive（自适应）" },
    { value: "16:9", label: "16:9（横屏宽）" },
    { value: "9:16", label: "9:16（竖屏）" },
    { value: "1:1", label: "1:1（方形）" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
    { value: "21:9", label: "21:9（电影超宽）" },
  ],
  videoResolution: [
    { value: "", label: "跟随全局默认" },
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p（fast 版不支持）" },
  ],
  videoDurationS: [
    { value: "", label: "跟随全局默认" },
    { value: "-1", label: "-1（模型自动）" },
    { value: "4", label: "4 秒" },
    { value: "5", label: "5 秒" },
    { value: "6", label: "6 秒" },
    { value: "8", label: "8 秒" },
    { value: "10", label: "10 秒" },
    { value: "12", label: "12 秒" },
    { value: "15", label: "15 秒" },
  ],
};

// 应用运行时状态（取代旧的 window.DB）
const STATE = {
  projects: [],     // 项目列表
  project: null,    // 当前项目
  brief: null,
  dialogue: [],
  script: null,
  characters: [],
  scenes: [],
  generic: [],
  tasks: [],
  timeline: null,
};

/* ---------- 渲染：导航 ---------- */
function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = STEPS.map(s => `
    <button class="nav-item ${s.id === CURRENT ? "active" : ""}" data-step="${s.id}">
      ${s.icon}<span>${s.label}</span><span class="step-no">${s.no}</span>
    </button>`).join("");
  nav.querySelectorAll(".nav-item").forEach(b =>
    b.onclick = () => go(b.dataset.step));
}

function renderTopbar() {
  const step = STEPS.find(s => s.id === CURRENT);
  const crumb = document.getElementById("crumb");
  const projName = STATE.project ? STATE.project.name : "未选择项目";

  // 项目下拉
  const opts = STATE.projects.map(p =>
    `<option value="${p.id}"${p.id === STATE.project?.id ? " selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
  crumb.innerHTML = `
    <select id="projSelect" class="proj-select" title="切换项目">${opts || `<option value="">（尚无项目）</option>`}</select>
    <button class="btn btn-ghost btn-sm" data-act="newProj" title="新建项目">${ICON.plus}</button>
    ${STATE.project ? `<button class="btn btn-ghost btn-sm" data-act="renameProj" title="重命名">${ICON.pen}</button>
      <button class="btn btn-ghost btn-sm" data-act="deleteProj" title="删除当前项目">${ICON.close}</button>` : ""}
    <span class="sep">/</span><b>${step.label}</b>`;
  const sel = crumb.querySelector("#projSelect");
  if (sel) sel.onchange = () => switchProject(sel.value);
  crumb.querySelectorAll("[data-act]").forEach(b => b.onclick = () => handleAct(b.dataset.act));

  const actions = STATE.project ? {
    brief: ``,
    script: `<button class="btn btn-ghost btn-sm" data-act="asset">${ICON.asset}素材库</button><button class="btn btn-ghost btn-sm" data-act="genChain" title="按幕序串行生成：以上一幕视频尾帧作为下一幕首帧衔接，本幕关键帧参考仍保留（仅 Seedance 2.0 系列，较慢）">${ICON.spark}顺序衔接生成</button><button class="btn btn-primary btn-sm" data-act="genAll">${ICON.spark}一键生成全部</button>`,
    gen: `<button class="btn btn-ghost btn-sm" data-act="asset">${ICON.asset}素材库</button><button class="btn btn-sm" data-act="toEditor">前往剪辑 →</button>`,
    editor: `<button class="btn btn-sm" data-act="export">导出剪辑清单</button>`,
  }[CURRENT] : "";
  const el = document.getElementById("topbarActions");
  const gearBtn = `<button class="btn btn-ghost btn-sm" data-act="settings" title="模型 API 凭证配置">${ICON.gear}设置</button>`;
  el.innerHTML = gearBtn + actions;
  el.querySelectorAll("[data-act]").forEach(b => b.onclick = () => handleAct(b.dataset.act));
}

async function handleAct(act) {
  if (act === "asset") openDrawer();
  else if (act === "genAll") await submitAll();
  else if (act === "genChain") await submitChain();
  else if (act === "toEditor") go("editor");
  else if (act === "export") await exportFilm();
  else if (act === "settings") openSettings();
  else if (act === "newProj") await createProjectFlow();
  else if (act === "renameProj") await renameProjectFlow();
  else if (act === "deleteProj") await deleteProjectFlow();
}

/* ---------- 项目管理 ---------- */
async function createProjectFlow() {
  const name = await dlgPrompt({ title: "新建项目", label: "项目名称", defaultValue: "未命名项目", primaryText: "创建" });
  if (!name) return;
  try {
    const p = await API.createProject({ name: name.trim(), spec: { aspect: "16:9", lang: "zh" } });
    STATE.projects = await API.listProjects().then(r => r.items || r);
    await switchProject(p.id);
    toast(`已创建项目：${p.name}`);
  } catch (e) { toast("创建失败：" + (e.message || "网络错误")); }
}
async function renameProjectFlow() {
  if (!STATE.project) return;
  const name = await dlgPrompt({ title: "重命名项目", label: "新项目名称", defaultValue: STATE.project.name, primaryText: "重命名" });
  if (!name || name.trim() === STATE.project.name) return;
  try {
    const p = await API.updateProject(STATE.project.id, { name: name.trim() });
    STATE.project = p;
    STATE.projects = await API.listProjects().then(r => r.items || r);
    renderTopbar();
    toast("已重命名");
  } catch (e) { toast("重命名失败：" + (e.message || "网络错误")); }
}
async function deleteProjectFlow() {
  if (!STATE.project) return;
  const ok = await dlgConfirm({
    title: "删除项目",
    message: `确认删除项目「${STATE.project.name}」？该操作不可撤销，所有分幕、素材与生成任务也将被清除。`,
    primaryText: "永久删除", danger: true,
  });
  if (!ok) return;
  try {
    const id = STATE.project.id;
    await API.deleteProject(id);
    STATE.projects = await API.listProjects().then(r => r.items || r);
    STATE.project = null;
    API.setPid("");
    if (STATE.projects.length) await switchProject(STATE.projects[0].id);
    else await ensureProject();
    toast("项目已删除");
  } catch (e) { toast("删除失败：" + (e.message || "网络错误")); }
}
async function switchProject(pid) {
  if (!pid) return;
  API.setPid(pid);
  STATE.project = await API.getProject();
  go(CURRENT || "brief");
}

/* 启动时确保有当前项目可用 */
async function ensureProject() {
  const list = await API.listProjects().then(r => r.items || r);
  STATE.projects = list;
  const saved = API.getPid();
  let target = list.find(p => p.id === saved) || list[0];
  if (!target) {
    // 没有任何项目 → 自动建一个，让首屏直接可用
    const created = await API.createProject({
      name: "未命名项目", spec: { aspect: "16:9", lang: "zh" },
    });
    STATE.projects = await API.listProjects().then(r => r.items || r);
    target = created;
  }
  API.setPid(target.id);
  STATE.project = await API.getProject();
}

/* 顺序衔接生成：按幕序串行生成视频，上一幕尾帧作下一幕首帧衔接 */
async function submitChain() {
  try {
    if (!STATE.script) STATE.script = await API.getScript();
    const scenes = (STATE.script?.scenes || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!scenes.length) {
      toast("脚本尚未生成，请先在需求对话页生成脚本");
      return;
    }
    // 关键帧是衔接的画风锚点：首幕以关键帧作首帧，后续幕关键帧仍作参考。缺失则提示先生成。
    const missing = scenes.filter(s => !s.kf).map(s => `幕${s.order}`);
    if (missing.length) {
      const ok = await dlgConfirm({
        title: "部分关键帧缺失",
        message: `${missing.join("、")} 尚无关键帧。顺序衔接依赖关键帧锚定画风，建议先「一键生成全部」产出关键帧。是否仍继续（缺失幕将仅靠上一幕尾帧与提示词衔接）？`,
        primaryText: "仍然继续",
      });
      if (!ok) return;
    }
    const items = scenes.map(s => ({ kind: "video", refId: s.id }));
    await API.submitChain(items);
    go("gen");
    toast(`已提交 ${items.length} 幕顺序衔接任务，将按幕序串行生成`);
  } catch (e) {
    toast("提交失败：" + (e.message || "网络错误"));
  }
}

/* 一键生成全部：按脚本各幕汇总素材项，提交生成任务 */
async function submitAll() {
  try {
    if (!STATE.script) STATE.script = await API.getScript();
    if (!STATE.script || !STATE.script.scenes?.length) {
      toast("脚本尚未生成，请先在需求对话页生成脚本");
      return;
    }
    const items = [];
    STATE.script.scenes.forEach(s => {
      (s.chars || []).forEach(c => items.push({ kind: "char_ref", refId: c.id }));
      items.push({ kind: "keyframe", refId: s.id });
      if (s.fx && s.fx.need) items.push({ kind: "fx", refId: s.id });
      items.push({ kind: "video", refId: s.id });
    });
    await API.submitGen(items);
    go("gen");
    toast(`已提交 ${items.length} 项生成任务，进入生成队列`);
  } catch (e) {
    toast("提交失败：" + (e.message || "网络错误"));
  }
}

/* 导出成片：当前阶段导出剪辑清单 JSON */
async function exportFilm() {
  try {
    const script = STATE.script || await API.getScript();
    const tasks  = await API.getTasks();
    const taskByRef = {};
    tasks.forEach(t => { if (t.refId) (taskByRef[t.refId] ||= []).push(t); });
    const cuts = (script?.scenes || []).map(s => ({
      order: s.order, title: s.title, sceneRefId: s.sceneRefId, sceneRef: s.sceneRef,
      duration_hint_s: null, narration: s.narration,
      keyframe: s.kf || null,
      assets: (taskByRef[s.id] || []).filter(t => t.status === "done").map(t => ({ kind: t.kind, mediaId: t.mediaId })),
    }));
    const manifest = {
      project: STATE.project,
      global: script?.global || null,
      cuts,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(STATE.project?.name || "videoflow").replace(/\s+/g, "_")}-cut.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("剪辑清单 JSON 已下载，可用作下游合成");
  } catch (e) {
    toast("导出失败：" + (e.message || "网络错误"));
  }
}

/* ---------- 路由 ---------- */
function go(step) {
  CURRENT = step;
  renderNav(); renderTopbar();
  const view = document.getElementById("view");
  view.scrollTop = 0;
  view.classList.toggle("view-flex", step === "brief");
  if (!STATE.project) {
    view.innerHTML = `<div class="page-head"><div class="page-title">请选择或新建一个项目</div>
      <div class="page-sub">顶部下拉切换项目，点击 <b>+</b> 新建。</div></div>`;
    return;
  }
  const fn = { brief: viewBrief, script: viewScript, gen: viewGen, editor: viewEditor }[step];
  Promise.resolve(fn(view)).catch(err => {
    console.error(err);
    view.innerHTML = `<div class="page-head"><div class="page-title">加载失败</div>
      <div class="page-sub">${escapeHtml(err.message || "接口请求出错")}</div></div>`;
  });
}

/* ---------- 通用：加载占位 ---------- */
function loadingHTML(msg) {
  return `<div class="view-loading">
    <span class="spinner" aria-hidden="true"></span>
    <span class="ld-txt">${msg || "加载中…"}</span>
  </div>`;
}

/* ============ 视图 1：需求对话 ============ */
async function viewBrief(root) {
  root.innerHTML = loadingHTML("加载需求单…");
  const [brief, dialogue] = await Promise.all([API.getBrief(), API.getDialogue()]);
  STATE.brief = brief; STATE.dialogue = dialogue;
  const b = STATE.brief;
  root.innerHTML = `
    <div class="brief-grid">
      <div class="chat-pane">
        <div class="chat-log" id="chatLog"></div>
        <div class="chat-input">
          <textarea id="chatBox" placeholder="描述你的视频需求，或回答 AI 的问题…  （Enter 发送）"></textarea>
          <button class="icon-btn send-btn" id="sendBtn">${ICON.send}</button>
        </div>
      </div>
      <div class="brief-pane">
        <h3>需求单 <span class="tag tag-accent">实时</span></h3>
        <div class="complete-row">
          <div class="lbl"><span>完整度</span><span id="cmpVal">${b.completeness}%</span></div>
          <div class="progress-rail"><span id="cmpBar" style="width:${b.completeness}%"></span></div>
        </div>
        <div class="brief-fields" id="briefFields"></div>
        <button class="btn btn-ghost btn-sm" id="addField">${ICON.plus}新增字段</button>
        <button class="btn btn-primary" id="toScript">
          ${ICON.spark} 生成脚本
        </button>
      </div>
    </div>`;

  const log = root.querySelector("#chatLog");
  STATE.dialogue.forEach(m => log.appendChild(bubble(m)));
  log.scrollTop = log.scrollHeight;

  renderBriefFields(root.querySelector("#briefFields"));

  const box = root.querySelector("#chatBox");
  const send = async () => {
    const t = box.value.trim(); if (!t) return;
    log.appendChild(bubble({ role: "me", text: t })); box.value = "";
    log.scrollTop = log.scrollHeight;
    const aiEl = bubble({ role: "ai", text: "" });
    const textEl = aiEl.querySelector(".text");
    textEl.classList.add("streaming");
    log.appendChild(aiEl);
    log.scrollTop = log.scrollHeight;
    try {
      const { brief } = await API.sendMessage(t, {
        onToken: (_d, full) => { textEl.textContent = full; log.scrollTop = log.scrollHeight; },
        onBrief: ({ brief, chips }) => {
          if (brief) { STATE.brief = brief; renderBriefFields(root.querySelector("#briefFields")); renderCompleteness(); }
          if (chips?.length) {
            const allMe = log.querySelectorAll(".msg.me");
            const last = allMe[allMe.length - 1];
            if (last && !last.querySelector(".chips")) {
              const chipBox = document.createElement("div");
              chipBox.className = "chips";
              chipBox.innerHTML = chips.map(c => `<span class="field-chip">${ICON.check}${escapeHtml(c)}</span>`).join("");
              last.querySelector(".bubble")?.appendChild(chipBox);
            }
          }
        },
      });
      textEl.classList.remove("streaming");
      if (brief) { STATE.brief = brief; renderBriefFields(root.querySelector("#briefFields")); renderCompleteness(); }
    } catch (e) {
      textEl.classList.remove("streaming");
      textEl.textContent = "发送失败：" + (e.message || "网络错误");
      textEl.style.color = "var(--danger)";
    }
  };
  root.querySelector("#sendBtn").onclick = send;
  box.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  root.querySelector("#addField").onclick = async () => {
    const k = await dlgPrompt({ title: "新增需求字段", label: "字段名", placeholder: "如：拍摄地点", primaryText: "添加" });
    if (!k) return;
    try {
      STATE.brief = await API.patchBrief({ [k.trim()]: "" });
      renderBriefFields(root.querySelector("#briefFields"));
      renderCompleteness();
    } catch (e) { toast("新增字段失败：" + (e.message || "网络错误")); }
  };

  root.querySelector("#toScript").onclick = async () => {
    const btn = root.querySelector("#toScript");
    btn.disabled = true; btn.innerHTML = `${ICON.spark} 正在生成脚本…`;
    try {
      STATE.script = await API.generateScript();
      toast(`脚本生成完成 · 共 ${STATE.script.scenes?.length || 0} 幕`);
      go("script");
    } catch (e) {
      toast("脚本生成失败：" + (e.message || "网络错误"));
    } finally {
      btn.disabled = false; btn.innerHTML = `${ICON.spark} 生成脚本`;
    }
  };
}

function bubble(m) {
  const el = document.createElement("div");
  el.className = `msg ${m.role}`;
  const chips = (m.chips || []).map(c => `<span class="field-chip">${ICON.check}${escapeHtml(c)}</span>`).join("");
  el.innerHTML = `
    <div class="avatar">${m.role === "ai" ? ICON.spark : ICON.user}</div>
    <div class="bubble"><span class="text">${escapeHtml(m.text || "")}</span>${chips ? `<div class="chips">${chips}</div>` : ""}</div>`;
  return el;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

/* 行内可编辑的需求单字段：失焦保存到后端 */
function renderBriefFields(box) {
  box.innerHTML = STATE.brief.fields.map(f => `
    <div class="bf ${f.done ? "" : "todo"}" data-k="${escapeHtml(f.k)}">
      <span class="state">${f.done ? ICON.check : ICON.circle}</span>
      <div class="bf-body">
        <div class="k">${escapeHtml(f.k)}</div>
        <input class="bf-input" type="text" value="${escapeHtml(f.v || "")}" placeholder="待补全…" />
      </div>
      <button class="bf-del icon-btn icon-btn-sm" data-bf-del="${escapeHtml(f.k)}" title="删除字段" aria-label="删除字段">${ICON.close}</button>
    </div>`).join("");
  box.querySelectorAll(".bf").forEach(el => {
    const k = el.dataset.k;
    const inp = el.querySelector(".bf-input");
    inp.onblur = async () => {
      const v = inp.value.trim();
      const cur = STATE.brief.fields.find(x => x.k === k);
      if (!cur || cur.v === v) return;
      try {
        STATE.brief = await API.patchBrief({ [k]: v });
        renderBriefFields(box); renderCompleteness();
      } catch (e) {
        toast("保存失败：" + (e.message || "网络错误"));
      }
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); };
  });
  box.querySelectorAll("[data-bf-del]").forEach(b => b.onclick = async () => {
    const k = b.dataset.bfDel;
    const ok = await dlgConfirm({
      title: "删除字段",
      message: `确认删除字段「${k}」？已填写的内容也会一起被清除。`,
      primaryText: "删除", danger: true,
    });
    if (!ok) return;
    try {
      STATE.brief = await API.deleteBriefField(k);
      renderBriefFields(box); renderCompleteness();
    } catch (e) {
      toast("删除失败：" + (e.message || "网络错误"));
    }
  });
}
function renderCompleteness() {
  const v = document.getElementById("cmpVal"), bar = document.getElementById("cmpBar");
  if (v) v.textContent = STATE.brief.completeness + "%";
  if (bar) bar.style.width = STATE.brief.completeness + "%";
}

/* ============ 视图 2：脚本故事板 ============ */
async function viewScript(root) {
  root.innerHTML = loadingHTML("加载脚本故事板…");
  STATE.script = await API.getScript();
  if (!STATE.script || !STATE.script.scenes?.length) {
    root.innerHTML = `
      <div class="page-head">
        <div class="page-title">脚本尚未生成</div>
        <div class="page-sub">回到「需求对话」页，补充关键字段，然后点击右下角 <b>生成脚本</b> 让 AI 出分幕。</div>
      </div>
      <button class="btn btn-primary" onclick="go('brief')">${ICON.brief} 回到需求对话</button>`;
    return;
  }
  const g = STATE.script.global || {};
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">脚本故事板</div>
      <div class="page-sub">AI 已根据需求单生成分幕脚本。每幕含场景、角色、动效、文案与三类 Prompt，可单独编辑与一键生成素材。</div>
    </div>
    <div class="card global-bar">
      ${gbItem("总幕数", (STATE.script.scenes?.length || 0) + " 幕")}${gbItem("预计时长", "约 " + (g.duration_s || 0) + "s")}
      ${gbItem("整体风格", escapeHtml(g.style || "—"))}${gbItem("BGM", escapeHtml(g.bgm || "—"))}${gbItem("旁白", escapeHtml(g.narration || "—"))}
      <div class="gb-spacer"></div>
      <button class="btn btn-ghost btn-sm" id="regen">${ICON.spark}重新生成</button>
    </div>
    <div class="scene-grid" id="sceneGrid"></div>`;
  const grid = root.querySelector("#sceneGrid");
  STATE.script.scenes.forEach(s => grid.appendChild(sceneCard(s)));
  root.querySelector("#regen").onclick = async () => {
    const ok = await dlgConfirm({
      title: "重新生成脚本",
      message: "重新生成脚本将覆盖现有分幕、角色、场景。是否继续？",
      primaryText: "重新生成", danger: true,
    });
    if (!ok) return;
    try {
      STATE.script = await API.generateScript();
      toast("脚本已重新生成");
      go("script");
    } catch (e) { toast("生成失败：" + (e.message || "网络错误")); }
  };
}
function gbItem(k, v) { return `<div class="gb-item"><span class="k">${k}</span><span class="v">${v}</span></div>`; }

function sceneCard(s) {
  const el = document.createElement("div");
  el.className = "card scene-card";
  const kf = s.kfState === "done"
    ? `<img src="${s.kf}" alt="关键帧" class="kf-preview" data-preview="${s.kf}" data-mime="image/png" title="点击预览"/>`
    : s.kfState === "generating"
      ? `<div class="ph">关键帧生成中…</div>`
      : `<div class="ph">${ICON.img}<div style="margin-top:6px">待生成关键帧</div></div>`;
  const chars = (s.chars || []).length
    ? s.chars.map(c => `<span class="ref-link" data-ref="char">${escapeHtml(c.name)}</span>`).join("、")
    : `<span class="muted">无角色</span>`;
  // 逐镜参数摘要：有覆盖则显示具体值，否则「默认」。
  const P = s.params || {};
  const paramBits = [
    P.imgSize ? `图 ${P.imgSize}` : null,
    P.videoRatio ? `比例 ${P.videoRatio}` : null,
    P.videoResolution ? P.videoResolution : null,
    (P.videoDurationS != null) ? `${P.videoDurationS === -1 ? "自动" : P.videoDurationS + "s"}` : null,
  ].filter(Boolean);
  const paramSummary = paramBits.length
    ? `<span class="scene-params-sum" title="本幕自定义参数">${ICON.gear}${escapeHtml(paramBits.join(" · "))}</span>`
    : `<span class="scene-params-sum muted" title="本幕使用全局默认参数">${ICON.gear}参数：默认</span>`;
  el.innerHTML = `
    <div class="kf ${s.kfState === "generating" ? "gen" : ""}">
      <span class="scene-idx">幕 ${s.order}</span>
      ${s.fx && s.fx.need ? `<span class="fx-flag tag tag-accent">${ICON.wand}${escapeHtml(s.fx.type || "")}</span>` : ""}
      ${kf}
    </div>
    <div class="scene-body">
      <div class="scene-title">${escapeHtml(s.title || "")}</div>
      <div class="scene-row">${ICON.scene}场景：<span class="ref-link" data-ref="scene">${escapeHtml(s.sceneRef || "—")}</span></div>
      <div class="scene-row">${ICON.user}角色：${chars}</div>
      <div class="scene-narr">${escapeHtml(s.narration || "")}</div>
      <div class="scene-param-row">${paramSummary}</div>
      <div class="scene-actions">
        <button class="btn btn-ghost btn-sm" data-params="${s.id}" title="设置本幕图片尺寸 / 视频比例·分辨率·时长">${ICON.gear}参数</button>
        <button class="btn btn-ghost btn-sm" data-prompt="${s.id}">${ICON.pen}编辑 Prompt</button>
        <button class="btn btn-sm btn-spacer" data-gen="${s.id}">${ICON.play}生成片段</button>
      </div>
    </div>`;
  el.querySelectorAll(".ref-link").forEach(r => r.onclick = () => openDrawer(r.dataset.ref === "char" ? "char" : "scene"));
  const kfEl = el.querySelector(".kf-preview");
  if (kfEl) kfEl.onclick = () => openPreview(kfEl.dataset.preview, kfEl.dataset.mime);
  el.querySelector(`[data-params]`).onclick = () => openSceneParams(s);
  el.querySelector(`[data-prompt]`).onclick = () => openPromptEditor(s);
  el.querySelector(`[data-gen]`).onclick = async () => {
    try {
      await API.submitGen([{ kind: "keyframe", refId: s.id }, { kind: "video", refId: s.id }]);
      go("gen"); toast(`幕${s.order}「${s.title}」已提交生成`);
    } catch (e) { toast("提交失败：" + (e.message || "网络错误")); }
  };
  return el;
}

/* ---- 逐镜参数抽屉：图片尺寸（关键帧）+ 视频比例/分辨率/时长 ---- */
function openSceneParams(s) {
  const d = document.getElementById("drawer"), scrim = document.getElementById("drawerScrim");
  d.classList.add("show"); scrim.classList.add("show"); d.setAttribute("aria-hidden", "false");
  const P = s.params || {};
  const sel = (key, cur) => {
    const opts = SCENE_PARAM_OPTS[key].map(o =>
      `<option value="${o.value}"${String(cur ?? "") === String(o.value) ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
    return `<select class="sp-sel" data-sp="${key}">${opts}</select>`;
  };
  d.innerHTML = `
    <div class="drawer-head">
      <h3>本幕参数 · 幕${s.order}「${escapeHtml(s.title || "")}」</h3>
      <button class="icon-btn icon-btn-sm" id="drawerClose">${ICON.close}</button>
    </div>
    <div class="drawer-body">
      <div class="pe-tip">仅对本幕生效，留「跟随全局默认」则使用右上角设置里的全局参数。修改后对之后发起的生成任务生效。</div>
      <div class="sp-group">
        <div class="sp-group-title">${ICON.img} 关键帧图片</div>
        <label class="sp-field"><span>图片尺寸</span>${sel("imgSize", P.imgSize)}</label>
      </div>
      <div class="sp-group">
        <div class="sp-group-title">${ICON.gen} 视频片段</div>
        <label class="sp-field"><span>画幅比例</span>${sel("videoRatio", P.videoRatio)}</label>
        <label class="sp-field"><span>分辨率</span>${sel("videoResolution", P.videoResolution)}</label>
        <label class="sp-field"><span>时长</span>${sel("videoDurationS", P.videoDurationS)}</label>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-ghost" id="spClose2">取消</button>
      <button class="btn btn-primary" id="spSave">${ICON.spark}保存参数</button>
    </div>`;
  d.querySelector("#drawerClose").onclick = closeDrawer;
  d.querySelector("#spClose2").onclick = closeDrawer;
  d.querySelector("#spSave").onclick = async () => {
    const val = (k) => d.querySelector(`select[data-sp="${k}"]`).value;
    const payload = {
      imgSize: val("imgSize"),
      videoRatio: val("videoRatio"),
      videoResolution: val("videoResolution"),
      videoDurationS: val("videoDurationS"),  // "" | "-1" | "4" ... 后端归一化
    };
    try {
      const saved = await API.saveSceneParams(s.id, payload);
      // 同步内存态并重渲染故事板，刷新参数摘要
      const node = (STATE.script?.scenes || []).find(x => x.id === s.id);
      if (node) node.params = saved;
      closeDrawer();
      if (CURRENT === "script") go("script");
      toast(`幕${s.order} 参数已保存`);
    } catch (e) { toast("保存失败：" + (e.message || "网络错误")); }
  };
}

/* ---- Prompt 编辑抽屉（数据源：后端 prompt 表，由 LLM 在脚本生成时落入） ---- */
function openPromptEditor(s) {
  const d = document.getElementById("drawer"), scrim = document.getElementById("drawerScrim");
  d.classList.add("show"); scrim.classList.add("show"); d.setAttribute("aria-hidden", "false");
  d.innerHTML = `
    <div class="drawer-head"><h3>编辑 Prompt · 幕${s.order}「${escapeHtml(s.title || "")}」</h3>
      <button class="icon-btn icon-btn-sm" id="drawerClose">${ICON.close}</button>
    </div>
    <div class="drawer-body">${loadingHTML("加载本幕 Prompt…")}</div>`;
  d.querySelector("#drawerClose").onclick = closeDrawer;
  scrim.onclick = closeDrawer;
  renderPromptEditor(s);
}

async function renderPromptEditor(s) {
  const d = document.getElementById("drawer");
  let prompts = [];
  try { prompts = await API.getPrompts(s.id); }
  catch (e) {
    d.querySelector(".drawer-body").innerHTML =
      `<div class="pe-tip">加载失败：${escapeHtml(e.message || "网络错误")}</div>`;
    return;
  }

  if (!prompts.length) {
    d.querySelector(".drawer-body").innerHTML = `
      <div class="pe-tip">本幕暂无 Prompt 记录。可能是脚本由旧版本生成的，建议在脚本页点击"重新生成"让 AI 重新产出包含 Prompt 的脚本。</div>`;
    return;
  }

  const iconOf = (kind) => kind === "char_ref" ? ICON.user : kind === "fx" ? ICON.wand : ICON.img;
  const sections = prompts.map(p => `
    <div class="pe-sec card" data-key="${escapeHtml(p.key)}" data-kind="${escapeHtml(p.kind)}">
      <div class="pe-sec-head">
        <span class="pe-ico">${iconOf(p.kind)}</span>
        <div class="pe-sec-meta">
          <div class="n">${escapeHtml(p.label || p.key)}</div>
          <div class="d">${escapeHtml(p.hint || "")}${p.version > 1 ? ` · v${p.version}` : ""}</div>
        </div>
      </div>
      <textarea class="pe-ta" data-pt="${escapeHtml(p.key)}" rows="4">${escapeHtml(p.text)}</textarea>
      <div class="pe-sec-actions">
        <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(p.key)}">${ICON.pen}复制</button>
        <button class="btn btn-sm" data-regen="${escapeHtml(p.key)}">${ICON.play}保存并重生此项</button>
      </div>
    </div>`).join("");

  d.innerHTML = `
    <div class="drawer-head">
      <h3>编辑 Prompt · 幕${s.order}「${escapeHtml(s.title || "")}」</h3>
      <button class="icon-btn icon-btn-sm" id="drawerClose">${ICON.close}</button>
    </div>
    <div class="drawer-body">
      <div class="pe-tip">以下 Prompt 在脚本生成时由 AI 针对本幕剧情逐条产出，可直接保存修改并提交生成。</div>
      ${sections}
    </div>
    <div class="drawer-foot">
      <button class="btn btn-ghost" id="peClose2">取消</button>
      <button class="btn btn-primary" id="peGenAll">${ICON.spark}保存并生成全部</button>
    </div>`;
  d.querySelector("#drawerClose").onclick = closeDrawer;
  d.querySelector("#peClose2").onclick = closeDrawer;
  d.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => {
    const ta = d.querySelector(`textarea[data-pt="${b.dataset.copy}"]`);
    if (ta) { ta.focus(); ta.select(); try { document.execCommand("copy"); } catch (e) {} toast("Prompt 已复制"); }
  });
  d.querySelectorAll("[data-regen]").forEach(b => b.onclick = async () => {
    const sec = b.closest(".pe-sec");
    const kind = sec.dataset.kind;
    const refId = kind === "char_ref" ? b.dataset.regen.replace(/^char_/, "") : s.id;
    try {
      await API.savePrompts(s.id, collectPrompts(d));
      await API.submitGen([{ kind, refId }]);
      toast(`已提交重生：${sec.querySelector(".pe-sec-meta .n").textContent}`);
    } catch (e) { toast("提交失败：" + (e.message || "网络错误")); }
    closeDrawer(); go("gen");
  });
  d.querySelector("#peGenAll").onclick = async () => {
    const items = prompts.map(p => ({
      kind: p.kind,
      refId: p.kind === "char_ref" ? p.key.replace(/^char_/, "") : s.id,
    }));
    try {
      await API.savePrompts(s.id, collectPrompts(d));
      await API.submitGen(items);
      toast(`幕${s.order}「${s.title}」共 ${items.length} 项素材已加入生成队列`);
    } catch (e) { toast("提交失败：" + (e.message || "网络错误")); }
    closeDrawer(); go("gen");
  };
}

function collectPrompts(d) {
  const out = {};
  d.querySelectorAll("textarea[data-pt]").forEach(ta => { out[ta.dataset.pt] = ta.value; });
  return out;
}

/* ============ 视图 3：素材生成 ============ */
let GEN_TIMER = null;
async function viewGen(root) {
  root.innerHTML = loadingHTML("加载生成队列…");
  STATE.tasks = await API.getTasks();
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">素材生成队列</div>
      <div class="page-sub">关键帧、视频片段与动效素材以异步任务执行。生成完成后挂载回对应分镜，可重试与多版本择优。</div>
    </div>
    <div class="gen-layout">
      <div class="task-list" id="taskList"></div>
      <div class="gen-aside">
        <div class="card">
          <h4>队列概览</h4>
          <div id="genStats"></div>
        </div>
      </div>
    </div>`;
  renderTasks(root);
  clearInterval(GEN_TIMER);
  GEN_TIMER = setInterval(() => tickTasks(root), 1000);
}
function renderTasks(root) {
  const list = root.querySelector("#taskList");
  if (!list) return;
  if (!STATE.tasks.length) {
    list.innerHTML = `<div class="empty-hint">尚无任务。在「脚本故事板」点击"一键生成全部"或单幕"生成片段"。</div>`;
    renderGenStats(root); return;
  }
  list.innerHTML = STATE.tasks.map(t => {
    const isVideo = (t.mediaMime || "").startsWith("video");
    const isImg   = (t.mediaMime || "").startsWith("image");
    // 缩略：视频用 <video>(静音、内联)，图片用 <img>，其余回退图标
    let thumb;
    if (isVideo && t.mediaUrl) thumb = `<video src="${t.mediaUrl}" muted playsinline preload="metadata"></video>`;
    else if (isImg && (t.thumb || t.mediaUrl)) thumb = `<img src="${t.thumb || t.mediaUrl}"/>`;
    else if (t.thumb) thumb = `<img src="${t.thumb}"/>`;
    else thumb = ICON.img;
    const pill = {
      queued: `<span class="status-pill status-queued">排队中</span>`,
      running: `<span class="status-pill status-running"><span class="pulse"></span>生成中</span>`,
      done: `<span class="status-pill status-done">${ICON.check}完成</span>`,
      failed: `<span class="status-pill status-failed">失败 · 重试</span>`,
      canceled: `<span class="status-pill status-queued">已取消</span>`,
    }[t.status] || "";
    // 有产物可预览时，缩略图区域可点击放大/播放
    const previewable = t.status === "done" && t.mediaUrl && (isVideo || isImg);
    const thumbAttrs = previewable
      ? ` class="task-thumb is-previewable" data-preview="${t.mediaUrl}" data-mime="${t.mediaMime}" title="点击预览"`
      : ` class="task-thumb"`;
    return `<div class="card task-row">
      <div${thumbAttrs}>${thumb}</div>
      <div class="task-info">
        <div class="t">${escapeHtml(t.title)}</div>
        <div class="s">${escapeHtml(t.sub || "")}${t.error ? " · " + escapeHtml(t.error) : ""}</div>
        ${t.status === "running" ? `<div class="task-bar"><span style="width:${t.progress}%"></span></div>` : ""}
      </div>
      <div>${pill}</div>
    </div>`;
  }).join("");
  // 绑定预览点击（打开 lightbox）
  list.querySelectorAll(".task-thumb.is-previewable").forEach(el => {
    el.onclick = () => openPreview(el.dataset.preview, el.dataset.mime);
  });
  renderGenStats(root);
}

// 素材预览 lightbox：图片显示大图，视频带控件播放；点遮罩/× 关闭
function openPreview(url, mime) {
  if (!url) return;
  const isVideo = (mime || "").startsWith("video");
  const inner = isVideo
    ? `<video src="${url}" controls autoplay playsinline class="lb-media"></video>`
    : `<img src="${url}" class="lb-media" alt="预览"/>`;
  const mask = document.createElement("div");
  mask.className = "lightbox-mask";
  mask.innerHTML = `<div class="lightbox-body">
    <button class="lightbox-close" title="关闭">✕</button>
    ${inner}
    <a class="lightbox-open" href="${url}" target="_blank" rel="noopener">在新标签打开原文件 ↗</a>
  </div>`;
  const close = () => { mask.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector(".lightbox-close").onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(mask);
}
function renderGenStats(root) {
  const c = k => STATE.tasks.filter(t => t.status === k).length;
  root.querySelector("#genStats").innerHTML = `
    <div class="stat-line"><span>总任务</span><span class="v">${STATE.tasks.length}</span></div>
    <div class="stat-line"><span style="color:var(--ok)">已完成</span><span class="v">${c("done")}</span></div>
    <div class="stat-line"><span style="color:var(--accent)">生成中</span><span class="v">${c("running")}</span></div>
    <div class="stat-line"><span class="muted">排队中</span><span class="v">${c("queued")}</span></div>
    <div class="stat-line"><span style="color:var(--danger)">失败</span><span class="v">${c("failed")}</span></div>`;
}
async function tickTasks(root) {
  // 离开生成视图时清掉轮询定时器，避免切走后仍每秒空转
  if (CURRENT !== "gen") { clearInterval(GEN_TIMER); return; }
  try {
    STATE.tasks = await API.getTasks();
    renderTasks(root);
    if (STATE.tasks.every(t => t.status === "done" || t.status === "failed" || t.status === "canceled"))
      clearInterval(GEN_TIMER);
  } catch (e) { /* 网络抖动静默 */ }
}

/* ============ 视图 4：剪辑成片（导出剪辑清单） ============ */
async function viewEditor(root) {
  root.innerHTML = loadingHTML("汇总剪辑清单…");
  const [script, tasks] = await Promise.all([API.getScript(), API.getTasks()]);
  STATE.script = script; STATE.tasks = tasks;
  if (!script || !script.scenes?.length) {
    root.innerHTML = `<div class="page-head"><div class="page-title">脚本尚未生成</div>
      <div class="page-sub">先回到「需求对话」生成脚本，再回来导出剪辑清单。</div></div>`;
    return;
  }
  const byRef = {};
  tasks.forEach(t => { if (t.refId) (byRef[t.refId] ||= []).push(t); });
  const rows = script.scenes.map(s => {
    const assets = (byRef[s.id] || []).filter(t => t.status === "done");
    const list = assets.length
      ? assets.map(a => `<span class="tag">${a.kind}</span>`).join(" ")
      : `<span class="muted">尚未有可用产物</span>`;
    return `<div class="card cut-row">
      <div class="cut-no">幕${s.order}</div>
      <div class="cut-body">
        <div class="cut-title">${escapeHtml(s.title)}</div>
        <div class="cut-desc">${escapeHtml(s.narration || "—")}</div>
      </div>
      <div class="cut-tags">${list}</div>
    </div>`;
  }).join("");
  root.innerHTML = `
    <div class="page-head">
      <div class="page-title">剪辑成片 <span class="tag tag-warn">导出清单</span></div>
      <div class="page-sub">当前版本不在浏览器内合成视频，可一键导出 <b>cut.json</b> 剪辑清单（含分幕、旁白、已生成素材引用），交给下游剪辑工具或人工完成最终合成。</div>
    </div>
    <div class="cut-list">${rows}</div>
    <div class="cut-export"><button class="btn btn-primary" id="doExport">${ICON.film}下载 cut.json</button></div>`;
  root.querySelector("#doExport").onclick = exportFilm;
}

/* ============ 抽屉：素材库 ============ */
async function openDrawer(tab = "char") {
  const d = document.getElementById("drawer"), scrim = document.getElementById("drawerScrim");
  d.classList.add("show"); scrim.classList.add("show"); d.setAttribute("aria-hidden", "false");
  d.innerHTML = `<div class="drawer-head"><h3>项目素材库</h3></div><div class="drawer-body">${loadingHTML("加载素材库…")}</div>`;
  scrim.onclick = closeDrawer;
  try {
    const [chars, scenes, generic] = await Promise.all([API.getCharacters(), API.getScenes(), API.getGeneric()]);
    STATE.characters = chars; STATE.scenes = scenes; STATE.generic = generic;
  } catch (e) { toast("加载失败：" + (e.message || "网络错误")); }
  renderDrawer(tab);
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("show", "drawer-wide");
  document.getElementById("drawerScrim").classList.remove("show");
}
function renderDrawer(tab) {
  const d = document.getElementById("drawer");
  const body = () => {
    if (tab === "char") return (STATE.characters || []).map(charItem).join("") || `<div class="empty-hint">尚无角色。脚本生成时会自动建立。</div>`;
    if (tab === "scene") return (STATE.scenes || []).map(sceneItem).join("") || `<div class="empty-hint">尚无场景。脚本生成时会自动建立。</div>`;
    // 通用素材：上传区 + 列表
    const list = (STATE.generic || []).map(genericItem).join("")
      || `<div class="empty-hint">尚无通用素材。点击上方"上传素材"添加品牌 logo、字幕底、转场素材等。</div>`;
    return `
      <div class="ga-import card">
        <div class="ga-up-head">${ICON.asset}<b>导入资源包 (.zip)</b><span class="muted" style="margin-left:auto;font-size:12px">整包 ≤ 300 MB</span></div>
        <div class="ga-import-hint">上传本项目导出的成片包，或任意含图片/视频/音频的 .zip。系统会自动解压并按类型（关键帧 / 视频 / 角色图 / 音频）导入到素材库，可直接预览。</div>
        <div class="ga-up-actions">
          <input id="apFile" type="file" accept=".zip,application/zip" />
          <button class="btn btn-primary btn-sm" id="apSubmit">${ICON.plus}解析并导入</button>
          <span class="muted" id="apStatus" style="font-size:12px;margin-left:8px"></span>
        </div>
      </div>
      <div class="ga-upload card">
        <div class="ga-up-head">${ICON.asset}<b>上传通用素材</b><span class="muted" style="margin-left:auto;font-size:12px">单文件 ≤ 50 MB</span></div>
        <div class="ga-up-grid">
          <input id="gaFile" type="file" accept="image/*,video/*,audio/*,.pdf" />
          <input id="gaName" type="text" placeholder="素材名称（必填）" />
          <select id="gaType">
            <option value="logo">品牌 logo</option>
            <option value="transition">转场素材</option>
            <option value="overlay">字幕底 / 叠加图</option>
            <option value="bgm">背景音乐</option>
            <option value="font">字体样张</option>
            <option value="reference">参考图</option>
            <option value="other" selected>其他</option>
          </select>
          <input id="gaDesc" type="text" placeholder="描述（可选）" />
        </div>
        <div class="ga-up-actions">
          <button class="btn btn-primary btn-sm" id="gaSubmit">${ICON.plus}上传</button>
          <span class="muted" id="gaStatus" style="font-size:12px;margin-left:8px"></span>
        </div>
      </div>
      <div class="ga-list">${list}</div>`;
  };
  d.innerHTML = `
    <div class="drawer-head"><h3>项目素材库</h3><button class="icon-btn icon-btn-sm" id="drawerClose">${ICON.close}</button></div>
    <div class="seg">
      <button class="${tab==="char"?"active":""}" data-tab="char">角色</button>
      <button class="${tab==="scene"?"active":""}" data-tab="scene">场景</button>
      <button class="${tab==="generic"?"active":""}" data-tab="generic">通用素材</button>
    </div>
    <div class="drawer-body">${body()}</div>`;
  d.querySelector("#drawerClose").onclick = closeDrawer;
  d.querySelectorAll(".seg button").forEach(b => b.onclick = () => renderDrawer(b.dataset.tab));
  d.querySelectorAll("[data-relock]").forEach(b => b.onclick = async () => {
    try { await API.lockCharacter(b.dataset.relock); toast("形象已重新锁定"); }
    catch (e) { toast("操作失败：" + (e.message || "网络错误")); }
  });
  if (tab === "generic") bindGenericUpload(d);
}

function bindGenericUpload(d) {
  const fileEl = d.querySelector("#gaFile");
  const nameEl = d.querySelector("#gaName");
  const typeEl = d.querySelector("#gaType");
  const descEl = d.querySelector("#gaDesc");
  const statusEl = d.querySelector("#gaStatus");
  const submitBtn = d.querySelector("#gaSubmit");
  fileEl?.addEventListener("change", () => {
    if (fileEl.files?.[0] && !nameEl.value) nameEl.value = fileEl.files[0].name;
  });
  submitBtn.onclick = async () => {
    const file = fileEl.files?.[0];
    if (!file) { statusEl.textContent = "请先选择文件"; statusEl.style.color = "var(--danger)"; return; }
    if (!nameEl.value.trim()) { statusEl.textContent = "请填写名称"; statusEl.style.color = "var(--danger)"; return; }
    submitBtn.disabled = true; statusEl.style.color = "var(--txt-2)"; statusEl.textContent = `上传中… (${(file.size / 1024 / 1024).toFixed(2)}MB)`;
    try {
      await API.uploadGenericAsset(file, { name: nameEl.value.trim(), type: typeEl.value, desc: descEl.value.trim() });
      STATE.generic = await API.getGeneric();
      renderDrawer("generic");
      toast("素材已上传");
    } catch (e) {
      submitBtn.disabled = false;
      statusEl.textContent = "上传失败：" + (e.message || "网络错误");
      statusEl.style.color = "var(--danger)";
    }
  };
  // 素材缩略图点击预览
  d.querySelectorAll(".asset-av.is-previewable").forEach(el =>
    el.onclick = () => openPreview(el.dataset.preview, el.dataset.mime));
  // 资源包(.zip)导入
  const apFile = d.querySelector("#apFile");
  const apSubmit = d.querySelector("#apSubmit");
  const apStatus = d.querySelector("#apStatus");
  if (apSubmit) apSubmit.onclick = async () => {
    const file = apFile.files?.[0];
    if (!file) { apStatus.textContent = "请先选择 .zip 文件"; apStatus.style.color = "var(--danger)"; return; }
    if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
      apStatus.textContent = "只支持 .zip 资源包"; apStatus.style.color = "var(--danger)"; return;
    }
    apSubmit.disabled = true; apStatus.style.color = "var(--txt-2)";
    apStatus.textContent = `解析并导入中… (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
    try {
      const r = await API.importAssetPack(file);
      STATE.generic = await API.getGeneric();
      renderDrawer("generic");
      const skipNote = r.skipped ? `，跳过 ${r.skipped} 项` : "";
      toast(`资源包已导入 ${r.imported} 个素材${skipNote}`);
    } catch (e) {
      apSubmit.disabled = false;
      apStatus.textContent = "导入失败：" + (e.message || "网络错误");
      apStatus.style.color = "var(--danger)";
    }
  };
  // 删除按钮
  d.querySelectorAll("[data-ga-del]").forEach(b => b.onclick = async () => {
    const ok = await dlgConfirm({
      title: "删除素材",
      message: `确认删除「${b.dataset.gaName}」？该操作不可撤销。`,
      primaryText: "删除", danger: true,
    });
    if (!ok) return;
    try {
      await API.deleteGenericAsset(b.dataset.gaDel);
      STATE.generic = await API.getGeneric();
      renderDrawer("generic");
      toast("素材已删除");
    } catch (e) { toast("删除失败：" + (e.message || "网络错误")); }
  });
}
function charItem(c) {
  return `<div class="card asset-item">
    <div class="asset-av">${c.img?`<img src="${c.img}"/>`:ICON.user}</div>
    <div class="asset-meta">
      <div class="n">${escapeHtml(c.name)} ${c.locked?`<span class="tag tag-ok">${ICON.check}形象已锁定</span>`:""}</div>
      <div class="d">${escapeHtml(c.desc || "")}${c.voice ? " · 声音：" + escapeHtml(c.voice) : ""} · v${c.version}</div>
      <div class="asset-actions">
        <button class="btn btn-ghost btn-sm" data-relock="${c.id}">${c.locked ? "重新锁定" : "锁定形象"}</button>
      </div>
    </div></div>`;
}
function sceneItem(s) {
  return `<div class="card asset-item">
    <div class="asset-av">${s.img?`<img src="${s.img}"/>`:ICON.scene}</div>
    <div class="asset-meta"><div class="n">${escapeHtml(s.name)}</div><div class="d">${escapeHtml(s.desc || "")}</div></div></div>`;
}
function genericItem(a) {
  const isImage = a.mime?.startsWith("image/");
  const isVideo = a.mime?.startsWith("video/");
  const isAudio = a.mime?.startsWith("audio/");
  const thumb = isImage ? `<img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}"/>`
              : isVideo ? `<video src="${escapeHtml(a.url)}" muted playsinline preload="metadata"></video>`
              : isAudio ? `<span style="font-size:11px">${escapeHtml(a.mime || "audio")}</span>`
              : ICON.asset;
  const sizeStr = a.size ? `${(a.size / 1024).toFixed(a.size > 1024 * 1024 ? 1 : 0)}${a.size > 1024 * 1024 ? "MB" : "KB"}` : "";
  const meta = [a.type, sizeStr, a.mime].filter(Boolean).join(" · ");
  const previewable = (isImage || isVideo) && a.url;
  const avAttrs = previewable
    ? ` class="asset-av is-previewable" data-preview="${escapeHtml(a.url)}" data-mime="${escapeHtml(a.mime)}" title="点击预览"`
    : ` class="asset-av"`;
  return `<div class="card asset-item">
    <div${avAttrs}>${thumb}</div>
    <div class="asset-meta">
      <div class="n">${escapeHtml(a.name)}</div>
      <div class="d">${escapeHtml(meta)}</div>
      ${a.desc ? `<div class="d">${escapeHtml(a.desc)}</div>` : ""}
      <div class="asset-actions">
        ${a.url ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${ICON.play}打开</a>` : ""}
        <button class="btn btn-ghost btn-sm" data-ga-del="${escapeHtml(a.id)}" data-ga-name="${escapeHtml(a.name)}">${ICON.close}删除</button>
      </div>
    </div></div>`;
}

/* ============ Toast ============ */
function toast(msg) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span class="ico">${ICON.spark}</span>${escapeHtml(msg)}`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(8px)"; setTimeout(() => t.remove(), 250); }, 2400);
}

/* ============ 自定义对话框：替代浏览器 prompt / confirm ============ */
function dlgOpen({ title, body, primaryText = "确认", primaryKind = "primary", cancelText = "取消", onPrimary }) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "modal-scrim show";
    const m = document.createElement("div");
    m.className = "modal show";
    m.innerHTML = `
      <div class="modal-head"><h3>${escapeHtml(title)}</h3>
        <button class="icon-btn icon-btn-xs modal-x" aria-label="关闭">${ICON.close}</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
        <button class="btn ${primaryKind === "danger" ? "btn-danger" : "btn-primary"}" data-act="ok">${escapeHtml(primaryText)}</button>
      </div>`;
    document.body.appendChild(scrim);
    document.body.appendChild(m);

    const close = (val) => {
      scrim.classList.remove("show"); m.classList.remove("show");
      setTimeout(() => { scrim.remove(); m.remove(); }, 200);
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
      else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); doOk(); }
    };
    const doOk = () => {
      const v = onPrimary ? onPrimary(m) : true;
      if (v === false) return; // 校验未通过
      close(v === undefined ? true : v);
    };
    scrim.onclick = () => close(null);
    m.querySelector(".modal-x").onclick = () => close(null);
    m.querySelector('[data-act="cancel"]').onclick = () => close(null);
    m.querySelector('[data-act="ok"]').onclick = doOk;
    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => {
      const f = m.querySelector("input,textarea,select");
      if (f) { f.focus(); if (f.select) f.select(); }
    });
  });
}

function dlgPrompt({ title, label, placeholder = "", defaultValue = "", primaryText = "确定" }) {
  const body = `
    <label class="modal-field">
      <span class="modal-label">${escapeHtml(label || title)}</span>
      <input class="modal-input" type="text" value="${escapeAttr(defaultValue)}" placeholder="${escapeAttr(placeholder)}" />
    </label>`;
  return dlgOpen({
    title, body, primaryText,
    onPrimary: (m) => {
      const v = (m.querySelector(".modal-input").value || "").trim();
      return v || null;
    },
  });
}

function dlgConfirm({ title = "确认", message, primaryText = "确认", danger = false }) {
  const body = `<div class="modal-message">${escapeHtml(message)}</div>`;
  return dlgOpen({
    title, body, primaryText,
    primaryKind: danger ? "danger" : "primary",
  });
}

/* ============ 启动 ============ */
(async function bootstrap() {
  try {
    await ensureProject();
    go("brief");
  } catch (e) {
    document.getElementById("view").innerHTML = `
      <div class="page-head">
        <div class="page-title">无法连接后端</div>
        <div class="page-sub">${escapeHtml(e.message || "请检查 server 是否启动 (node server/server.js)")}</div>
      </div>`;
    renderNav();
    document.getElementById("crumb").innerHTML = `<b>VideoFlow</b>`;
    document.getElementById("topbarActions").innerHTML =
      `<button class="btn btn-ghost btn-sm" onclick="openSettings()">${ICON.gear}设置</button>`;
  }
})();

/* ============ 设置抽屉：在线编辑模型 API 凭证 ============ */
async function openSettings() {
  const d = document.getElementById("drawer"), scrim = document.getElementById("drawerScrim");
  d.classList.add("show", "drawer-wide"); scrim.classList.add("show"); d.setAttribute("aria-hidden", "false");
  d.innerHTML = `<div class="drawer-head"><h3>模型 API 凭证</h3>
      <button class="icon-btn icon-btn-sm" id="drawerClose">${ICON.close}</button>
    </div><div class="drawer-body">${loadingHTML("加载配置…")}</div>`;
  scrim.onclick = closeDrawer;
  d.querySelector("#drawerClose").onclick = closeDrawer;
  try {
    const s = await API.getSettings();
    renderSettings(d, s);
  } catch (e) {
    d.querySelector(".drawer-body").innerHTML = `<div class="pe-tip">加载失败：${escapeHtml(e.message || e)}</div>`;
  }
}

function renderSettings(d, s) {
  const supported = new Set(s.supportedKinds || []);
  const kindLabel = { char_ref: "角色参考图", keyframe: "关键帧", video: "视频片段", fx: "动效", voice: "配音" };
  const groups = Object.entries(s.groups).map(([gKey, g]) => {
    const status = s.channelStatus[gKey] || { ready: false, kinds: [] };
    const kinds = (status.kinds || []).filter(k => supported.has(k))
      .map(k => `<span class="tag ${status.ready ? "tag-ok" : "tag-warn"}">${kindLabel[k] || k}</span>`).join("");
    const dot = `<span class="status-dot ${status.ready ? "on" : ""}"></span>`;
    const fields = g.fields.map(f => {
      const v = f.value ?? "";
      const placeholder = f.secret
        ? (f.filled ? "•••••••• 已保存（留空则不变）" : (f.hint || ""))
        : (f.hint || "");
      const isNum = f.type === "number" || (f.type === "enum" && f.options?.some(o => typeof o.value === "number"));
      const numAttr = isNum ? ' data-num="1"' : "";
      let control;
      if (f.type === "enum") {
        const opts = (f.options || []).map(o =>
          `<option value="${escapeAttr(o.value)}"${String(v) === String(o.value) ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
        control = `<div class="set-select-wrap">
          <select class="set-input set-select" data-g="${gKey}" data-k="${f.key}" data-secret="0"${numAttr}>${opts}</select>
        </div>`;
      } else if (f.type === "enum-open") {
        // 可输入下拉：input + datalist
        const listId = `dl_${gKey}_${f.key}`;
        const opts = (f.options || []).map(o =>
          `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join("");
        control = `<input class="set-input" data-g="${gKey}" data-k="${f.key}" data-secret="0"
                          type="text" list="${listId}" autocomplete="off"
                          placeholder="${escapeAttr(placeholder || "选择或输入自定义值")}"
                          value="${escapeAttr(v)}"/>
                  <datalist id="${listId}">${opts}</datalist>`;
      } else {
        const type = f.secret ? "password" : (f.type === "number" ? "number" : "text");
        control = `<input class="set-input" data-g="${gKey}" data-k="${f.key}" data-secret="${f.secret ? 1 : 0}"${numAttr}
                          type="${type}" autocomplete="off" placeholder="${escapeAttr(placeholder)}" value="${f.secret ? "" : escapeAttr(v)}"/>`;
      }
      const WIDE_KEYS = new Set(["apiKey", "baseUrl", "endpoint", "publicBaseUrl", "accessKey"]);
      const wide = WIDE_KEYS.has(f.key) || f.type === "enum-open";
      return `<label class="set-field${wide ? " set-wide" : ""}">
        <span class="set-k">${escapeHtml(f.label)}${f.required ? ' <em style="color:var(--danger)">*</em>' : ""}</span>
        ${control}
      </label>`;
    }).join("");
    return `<div class="card set-group">
      <div class="set-group-head">${dot}<b>${g.label}</b><span class="head-tags">${kinds}</span></div>
      <div class="set-group-body">${fields}</div>
    </div>`;
  }).join("");

  d.querySelector(".drawer-body").innerHTML = `
    <div class="pe-tip">凭证持久化到服务端 <code>data/settings.json</code>，修改即时生效，无需重启。敏感字段不会回传到前端，留空表示沿用已保存值。仅以下素材类型已接入真实模型：${(s.supportedKinds || []).map(k => kindLabel[k] || k).join(" / ")}。</div>
    ${groups}`;

  let foot = d.querySelector(".drawer-foot");
  if (!foot) {
    foot = document.createElement("div");
    foot.className = "drawer-foot";
    d.appendChild(foot);
  }
  foot.innerHTML = `<button class="btn btn-ghost" id="setCancel">关闭</button>
    <button class="btn btn-primary" id="setSave">${ICON.check}保存配置</button>`;
  foot.querySelector("#setCancel").onclick = closeDrawer;
  foot.querySelector("#setSave").onclick = async () => {
    const patch = collectSettings(d);
    try {
      const updated = await API.saveSettings(patch);
      const ready = Object.values(updated.channelStatus).filter(x => x.ready).length;
      toast(`已保存 · ${ready}/${Object.keys(updated.channelStatus).length} 个通道就绪`);
      renderSettings(d, updated);
    } catch (e) {
      toast("保存失败：" + (e.message || "网络错误"));
    }
  };
}

function collectSettings(d) {
  const patch = {};
  d.querySelectorAll(".set-input").forEach(inp => {
    const g = inp.dataset.g, k = inp.dataset.k;
    const isSecret = inp.dataset.secret === "1";
    const isNum = inp.dataset.num === "1" || inp.type === "number";
    const v = inp.value;
    if (isSecret && v === "") return;
    (patch[g] ||= {})[k] = isNum ? (v === "" ? "" : Number(v)) : v;
  });
  return patch;
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
