// ===================================================================
// VideoFlow · Electron preload
// -------------------------------------------------------------------
// 把主进程生成的随机访问令牌注入到页面的 window.VF_TOKEN，
// 前端 api.js 会自动带上 Authorization: Bearer <token> 访问 /v1。
// 令牌经 additionalArguments 以 --vf-token=<hex> 传入，避免走网络。
// ===================================================================
const { contextBridge } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--vf-token="));
const token = arg ? arg.slice("--vf-token=".length) : "";

// 页面运行在 contextIsolation 隔离世界，需通过 contextBridge 暴露到主世界 window。
contextBridge.exposeInMainWorld("VF_TOKEN", token);
