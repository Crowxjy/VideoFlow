// ===================================================================
// AI 视频工作台 · 异步生成任务队列
// - 真实异步：提交即入库(queued)，队列按并发上限拉起 -> running -> done/failed
// - 调用 provider 产出真实产物，写入 media 表，并挂回对应分镜(关键帧)
// - 任务完成后回调 webhook(若任务带 webhook 字段)
// - 进度：provider 执行期间平滑推进，完成置 100
// ===================================================================
export function makeQueue(dao, provider, { concurrency = 2 } = {}) {
  let running = 0;
  const timers = new Map(); // taskId -> progress interval

  async function callWebhook(url, body) {
    if (!url) return;
    try {
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { /* webhook 失败不影响任务本身 */ }
  }

  function startProgress(id) {
    let p = 5;
    dao.updateTask(id, { status: "running", progress: p });
    const tm = setInterval(() => {
      const t = dao.rawTask(id);
      if (!t || t.status !== "running") { clearInterval(tm); timers.delete(id); return; }
      p = Math.min(92, p + Math.round(Math.random() * 10 + 5));
      dao.updateTask(id, { progress: p });
    }, 700);
    timers.set(id, tm);
  }
  function stopProgress(id) {
    const tm = timers.get(id);
    if (tm) { clearInterval(tm); timers.delete(id); }
  }

  // 单个任务的完整生命周期：调用 provider → 落库 media → 更新任务 → 回调 webhook。
  // 被普通队列 run() 与顺序链路 runChain() 复用。chain=true 时强制回传尾帧。
  async function execTask(task, { chain = false } = {}) {
    startProgress(task.id);
    try {
      const payload = {
        title: task.title, sub: task.sub, kind: task.kind, prompt: task.prompt,
        refImageUrl: task.ref_image_url, firstFrameUrl: task.first_frame_url,
        model: task.model, refId: task.ref_id, chain,
      };
      const out = await provider.generate(task.kind, payload);
      const mediaId = dao.addMedia(task.project_id, { kind: task.kind, task_id: task.id, ...out });
      stopProgress(task.id);
      const patch = { status: "done", progress: 100, media_id: mediaId };
      // 视觉类产物给个缩略图
      if (out.mime && out.mime.startsWith("image")) patch.thumb = out.url;
      // 顺序衔接：把本幕尾帧落库，供下一幕作首帧
      if (out.lastFrameUrl) patch.last_frame_url = out.lastFrameUrl;
      dao.updateTask(task.id, patch);
      // 关键帧挂回分镜
      if (task.kind === "keyframe" && task.ref_id) dao.attachKeyframe(task.ref_id, out.url);
      await callWebhook(task.webhook, { event: "task.done", task: dao.getTask(task.id), mediaUrl: out.url });
      return out;
    } catch (e) {
      stopProgress(task.id);
      dao.updateTask(task.id, { status: "failed", error: String(e.message || e) });
      await callWebhook(task.webhook, { event: "task.failed", task: dao.getTask(task.id), error: String(e.message || e) });
      throw e;
    }
  }

  async function run(task) {
    running++;
    try {
      await execTask(task, { chain: false });
    } catch { /* execTask 已记录 failed */ } finally {
      running--;
      pump();
    }
  }

  // 顺序衔接链路：按顺序串行执行视频任务，把上一幕尾帧作为下一幕首帧注入。
  // - 已完成的任务跳过执行，但其尾帧仍作为后续衔接来源（支持断点续跑）。
  // - 某一幕失败则中断链路，其后任务标记为 failed。
  async function runChain(taskRows) {
    let prevTail = null;
    for (let i = 0; i < taskRows.length; i++) {
      const cur = dao.rawTask(taskRows[i].id);
      if (!cur || cur.status === "canceled") continue;
      if (cur.status === "done") { prevTail = cur.last_frame_url || prevTail; continue; }
      // 注入上一幕尾帧作为本幕首帧（首幕 prevTail 为空，仅用关键帧）
      if (prevTail) dao.updateTask(cur.id, { first_frame_url: prevTail });
      const fresh = dao.rawTask(cur.id);
      try {
        const out = await execTask(fresh, { chain: true });
        prevTail = out.lastFrameUrl || null;
        if (!prevTail) console.warn(`[chain] 任务 ${cur.id} 未返回尾帧，后续幕将回退为关键帧首帧`);
      } catch {
        // 链路中断：其后未完成任务统一标记失败
        for (let j = i + 1; j < taskRows.length; j++) {
          const rest = dao.rawTask(taskRows[j].id);
          if (rest && (rest.status === "queued" || rest.status === "running")) {
            dao.updateTask(rest.id, { status: "failed", error: "上一幕生成失败，顺序衔接链路中断" });
          }
        }
        break;
      }
    }
  }

  // 拉起排队任务直到达到并发上限
  function pump() {
    while (running < concurrency) {
      const next = dao.rawTask ? pickQueued() : null;
      if (!next) break;
      // 立刻置为 running 占位，避免被重复拉起
      dao.updateTask(next.id, { status: "running", progress: 1 });
      run(next);
    }
  }

  function pickQueued() {
    // 取最早的一个 queued（跨所有项目）
    return queuedFinder();
  }

  // 由 server 注入一个「找下一个 queued 任务」的函数（避免在此写死 SQL）
  let queuedFinder = () => null;
  function setQueuedFinder(fn) { queuedFinder = fn; }

  return {
    submit(task) {           // task 为 rawTask 行
      // 入库时已是 queued，这里只触发调度
      pump();
      return task;
    },
    // 顺序衔接：串行执行一组已入库的链路任务（不进普通并发池）
    async runChain(taskRows) {
      await runChain(taskRows);
    },
    retry(id) {
      dao.updateTask(id, { status: "queued", progress: 0, error: null, media_id: null });
      pump();
      return dao.getTask(id);
    },
    cancel(id) {
      stopProgress(id);
      dao.updateTask(id, { status: "canceled" });
      return dao.getTask(id);
    },
    setQueuedFinder,
    kick: pump,
  };
}
