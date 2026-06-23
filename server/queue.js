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

  async function run(task) {
    running++;
    startProgress(task.id);
    try {
      const payload = {
        title: task.title, sub: task.sub, kind: task.kind, prompt: task.prompt,
        refImageUrl: task.ref_image_url, model: task.model, refId: task.ref_id,
      };
      const out = await provider.generate(task.kind, payload);
      const mediaId = dao.addMedia(task.project_id, { kind: task.kind, task_id: task.id, ...out });
      stopProgress(task.id);
      const patch = { status: "done", progress: 100, media_id: mediaId };
      // 视觉类产物给个缩略图
      if (out.mime && out.mime.startsWith("image")) patch.thumb = out.url;
      dao.updateTask(task.id, patch);
      // 关键帧挂回分镜
      if (task.kind === "keyframe" && task.ref_id) dao.attachKeyframe(task.ref_id, out.url);
      await callWebhook(task.webhook, { event: "task.done", task: dao.getTask(task.id), mediaUrl: out.url });
    } catch (e) {
      stopProgress(task.id);
      dao.updateTask(task.id, { status: "failed", error: String(e.message || e) });
      await callWebhook(task.webhook, { event: "task.failed", task: dao.getTask(task.id), error: String(e.message || e) });
    } finally {
      running--;
      pump();
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
