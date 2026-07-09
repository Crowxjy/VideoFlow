// ===================================================================
// VideoFlow · Electron 主进程
// -------------------------------------------------------------------
// 职责：
//   1) 选一个空闲端口
//   2) 用 Electron 内置的 Node 运行时以子进程方式启动后端 server.js
//      （通过 ELECTRON_RUN_AS_NODE=1 让 Electron 二进制当纯 Node 用）
//   3) 把数据/产物目录指向用户可写目录（App 内部只读）
//   4) 等后端就绪后开窗口，指向 http://127.0.0.1:<port>/
//
// 密钥仍由用户在页面「⚙ 设置」里填写，落到用户本地 settings.json，天然隔离。
// ===================================================================
import { app, BrowserWindow, shell, dialog } from "electron";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { ensureCloudflared, startTunnel } from "./tunnel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");           // 打包后为 resources/app（只读）
const SERVER_ENTRY = join(REPO_ROOT, "server", "server.js");
const PRELOAD = join(__dirname, "preload.cjs");

// 每次启动生成随机访问令牌：后端子进程与前端窗口共享，防止隧道/局域网无鉴权访问 /v1。
const ACCESS_TOKEN = randomBytes(24).toString("hex");

// 必须在任何 app.getPath() 之前设置，否则 userData 会落到默认的 Electron/Chromium 目录。
app.setName("VideoFlow");
// 视频工作台不依赖 GPU 渲染；关闭硬件加速可避免在虚拟机/受限环境下 GPU 进程崩溃。
app.disableHardwareAcceleration();

let serverProc = null;
let mainWindow = null;
let tunnel = null;

// 起隧道并把公网地址写进后端 settings（ark.publicBaseUrl），供图生视频/顺序衔接使用。
// 全程失败不阻断应用启动——文生视频仍可用，仅图生视频会提示需要公网地址。
async function setupTunnel(port, userDataDir) {
  try {
    const binDir = join(userDataDir, "bin");
    const binPath = await ensureCloudflared(binDir, (m) => console.log(`[tunnel] ${m}`));
    tunnel = await startTunnel(binPath, port, { log: (m) => console.log(m) });
    console.log(`[tunnel] 公网地址就绪：${tunnel.url}`);
    // 通过本地 API 写入 settings，复用现成持久化逻辑（/v1 已鉴权，需带令牌）
    const r = await fetch(`http://127.0.0.1:${port}/v1/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ ark: { publicBaseUrl: tunnel.url } }),
    });
    if (!r.ok) console.warn(`[tunnel] 写入 publicBaseUrl 失败：HTTP ${r.status}`);
    else console.log("[tunnel] 已自动填入 ark.publicBaseUrl");
  } catch (e) {
    console.warn(`[tunnel] 隧道自动配置失败（图生视频将不可用，文生视频不受影响）：${e.message}`);
  }
}

// 找一个空闲端口（让系统随机分配，避免与用户其它服务冲突）
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// 轮询后端就绪：只要能建立 HTTP 响应即视为已监听（/v1 已鉴权，401 也算“起来了”）。
async function waitForServer(port, timeoutMs = 20000) {
  const startedAt = Date.now();
  const url = `http://127.0.0.1:${port}/v1/settings`;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status > 0) return true;   // 有任何 HTTP 状态即说明后端在监听
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startServer(port, userDataDir) {
  const mediaDir = join(userDataDir, "media");
  const dataDir = join(userDataDir, "data");
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",         // 关键：把 Electron 当纯 Node 跑
    PORT: String(port),
    VF_PROVIDER: "real",               // 桌面版默认接真实模型（用户自填 key）
    VF_TOKEN: ACCESS_TOKEN,            // 强制鉴权：/v1 需带此令牌（/media 与静态资源不需要）
    VF_HOST: "127.0.0.1",              // 只绑回环，隧道也只把 /media 暴露给模型侧
    VF_MEDIA_DIR: mediaDir,
    VF_DATA_DIR: dataDir,
    VF_DB: join(dataDir, "videoflow.db"),
  };

  // node:sqlite 目前仍是实验特性，需带该标志
  serverProc = spawn(process.execPath, ["--experimental-sqlite", SERVER_ENTRY], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    if (code && code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("VideoFlow 后端异常退出", `退出码 ${code}，请查看日志。`);
    }
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: "VideoFlow",
    backgroundColor: "#0e1118",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD,          // 注入 window.VF_TOKEN，让前端带令牌访问 /v1
      additionalArguments: [`--vf-token=${ACCESS_TOKEN}`],
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  // 外链用系统浏览器打开，不在应用内跳转
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    const userDataDir = app.getPath("userData");   // ~/Library/Application Support/VideoFlow
    const port = await findFreePort();
    startServer(port, userDataDir);

    const ready = await waitForServer(port);
    if (!ready) {
      dialog.showErrorBox("VideoFlow 启动失败", "后端服务在 20 秒内未就绪，请重试或查看日志。");
      app.quit();
      return;
    }
    createWindow(port);
    // 隧道在后台异步配置：窗口立即可用，隧道就绪后自动填入 settings（不阻塞 UI）
    setupTunnel(port, userDataDir);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  } catch (e) {
    dialog.showErrorBox("VideoFlow 启动异常", String(e?.stack || e));
    app.quit();
  }
});

app.on("before-quit", () => { app.isQuitting = true; });
app.on("window-all-closed", () => {
  if (tunnel) { try { tunnel.stop(); } catch {} }
  if (serverProc) { try { serverProc.kill(); } catch {} }
  if (process.platform !== "darwin") app.quit();
  else app.quit();  // 桌面版：关窗即退（含后端与隧道），避免残留后台进程
});
