// 第三方 Agent 通过 child_process 直接驱动 VideoFlow 的最小示例
// 无需 import 任何包，只用 Node 内置 spawn / 解析 JSON
// 运行: node skills/videoflow/examples/agent-driver.mjs

import { spawn } from "node:child_process";

const CLI = process.env.VIDEOFLOW_CLI || "videoflow";

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(CLI, [...args, "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (c) => out += c);
    p.stderr.on("data", (c) => err += c);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${CLI} ${args.join(" ")} → ${code}\n${err}`));
      try { resolve(JSON.parse(out)); } catch { resolve(out); }
    });
  });
}

async function main() {
  console.log("► health");
  const h = await run(["health"]);
  if (!h.channels?.chat?.ready) {
    console.error("✗ chat 通道未配置，先到前端「设置」填 API Key");
    process.exit(1);
  }

  console.log("► 创建项目");
  const proj = await run(["projects", "create", "Agent 自动化测试"]);
  console.log("  →", proj.id, proj.name);

  console.log("► 对话补全需求");
  const reply = await run([
    "chat", "send",
    "30 秒视频，TikTok 投放，Z 世代受众，主打智能家居便捷性，品牌色蓝紫渐变",
  ]);
  console.log("  AI 回复:", reply.reply?.slice(0, 80) + "...");
  console.log("  完成度:", reply.brief?.completeness, "%");

  console.log("► 生成脚本");
  const script = await run(["script", "generate"]);
  console.log("  脚本场景数:", script.scenes?.length);

  console.log("► 提交素材任务");
  const sub = await run(["gen", "submit"]);
  console.log("  提交:", sub.submitted, "项");

  // 轮询
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const tasks = await run(["gen", "tasks"]);
    const items = tasks.items || tasks;
    const summary = items.reduce((m, t) => (m[t.status] = (m[t.status] || 0) + 1, m), {});
    console.log(`  [${i}]`, summary);
    if ((summary.queued || 0) + (summary.running || 0) === 0) break;
  }

  console.log("► 导出剪辑清单");
  const cut = await run(["export"]);
  console.log("  cuts:", cut.cuts?.length, "  exportedAt:", cut.exportedAt);
}

main().catch(e => { console.error(e); process.exit(1); });
