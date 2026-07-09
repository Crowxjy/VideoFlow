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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");           // 打包后为 resources/app（只读）
const SERVER_ENTRY = join(REPO_ROOT, "server", "server.js");

// 必须在任何 app.getPath() 之前设置，否则 userData 会落到默认的 Electron/Chromium 目录。
app.setName("VideoFlow");
// 视频工作台不依赖 GPU 渲染；关闭硬件加速可避免在虚拟机/受限环境下 GPU 进程崩溃。
app.disableHardwareAcceleration();

let serverProc = null;
let mainWindow = null;

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

// 轮询后端 health，直到就绪或超时
async function waitForServer(port, timeoutMs = 20000) {
  const startedAt = Date.now();
  const url = `http://127.0.0.1:${port}/v1/settings`;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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
  if (serverProc) { try { serverProc.kill(); } catch {} }
  if (process.platform !== "darwin") app.quit();
  else app.quit();  // 桌面版：关窗即退（含后端），避免残留后台进程
});
