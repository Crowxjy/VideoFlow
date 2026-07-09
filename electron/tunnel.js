// ===================================================================
// VideoFlow · cloudflared 隧道自动化
// -------------------------------------------------------------------
// 图生视频/顺序衔接需要把本机 /media/* 暴露成公网可达 URL 供火山方舟拉取。
// 本模块让桌面版全自动完成：定位/下载 cloudflared → 起临时隧道 →
// 抓取 https://xxx.trycloudflare.com → 回调交给主进程写进 settings。
// 用户全程无感，无需敲命令、无需 Cloudflare 账号。
// ===================================================================
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, chmodSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// Cloudflare 官方 release 资产名（macOS 为 .tgz，内含单个 cloudflared 可执行文件）
function assetName() {
  return arch() === "arm64" ? "cloudflared-darwin-arm64.tgz" : "cloudflared-darwin-amd64.tgz";
}
function downloadUrl() {
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/${assetName()}`;
}

// 确保 cloudflared 就位：优先用 binDir 内已下载的；否则自动下载解压。
export async function ensureCloudflared(binDir, log = () => {}) {
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, "cloudflared");
  if (existsSync(binPath)) return binPath;

  log(`首次使用：下载 cloudflared（${assetName()}）…`);
  const tgz = join(binDir, assetName());
  const res = await fetch(downloadUrl(), { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`下载 cloudflared 失败：HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tgz));

  // 用系统 tar 解压（macOS 自带），产出 cloudflared 可执行文件
  await new Promise((resolve, reject) => {
    const p = spawn("tar", ["-xzf", tgz, "-C", binDir], { stdio: "ignore" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`解压 cloudflared 失败，tar 退出码 ${code}`))));
    p.on("error", reject);
  });
  if (!existsSync(binPath)) throw new Error("解压后未找到 cloudflared 可执行文件");
  chmodSync(binPath, 0o755);
  log("cloudflared 就绪");
  return binPath;
}

// 启动临时隧道，指向本机 http://127.0.0.1:<port>。
// 返回 { url, stop() }；url 为解析到的 https://xxx.trycloudflare.com。
export async function startTunnel(binPath, port, { log = () => {}, timeoutMs = 30000 } = {}) {
  const proc = spawn(binPath, [
    "tunnel", "--no-autoupdate",
    "--url", `http://127.0.0.1:${port}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

  const url = await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
    const onData = (buf) => {
      const s = buf.toString();
      log(`[cloudflared] ${s.trim()}`);
      const m = s.match(urlRe);
      if (m) finish(resolve, m[0]);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);   // cloudflared 把 URL 打在 stderr
    proc.on("exit", (code) => finish(reject, new Error(`cloudflared 提前退出，退出码 ${code}`)));
    proc.on("error", (e) => finish(reject, e));
    setTimeout(() => finish(reject, new Error("cloudflared 隧道在超时前未就绪")), timeoutMs);
  });

  return {
    url,
    stop() { try { proc.kill(); } catch { /* 已退出 */ } },
  };
}
