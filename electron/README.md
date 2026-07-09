# VideoFlow · Mac 桌面版（Electron）

把 VideoFlow 打包成 macOS 桌面应用。每个用户在自己电脑上运行，**API Key 由用户在应用内「⚙ 设置」填写**，保存到本机用户目录，天然隔离——不存在多人共用密钥/数据的问题。

## 架构

```
Electron 主进程 (electron/main.js)
  ├─ 选空闲端口
  ├─ 用 Electron 内置 Node 以子进程启动 server/server.js
  │    · ELECTRON_RUN_AS_NODE=1  → 把 Electron 当纯 Node 跑
  │    · --experimental-sqlite   → node:sqlite 需要此标志
  │    · VF_MEDIA_DIR / VF_DATA_DIR → 指向用户可写目录
  │      (~/Library/Application Support/VideoFlow/)
  └─ 开窗口 → http://127.0.0.1:<port>/  （前端同源自动连后端）
```

- 前端 `api.js` 已支持同源解析：窗口加载 `http://127.0.0.1:<port>/` 后会自动把后端定位到 `<origin>/v1`，无需改前端。
- `server.js` 的产物/数据目录已支持 `VF_MEDIA_DIR` / `VF_DATA_DIR` 覆盖；本地开发不设这两个变量时行为不变（仍写仓库内 `media/`、`data/`）。

## 前置要求

- macOS
- Node.js ≥ 18（仅用于跑 `npm install` 拉依赖；运行时用的是 Electron 内置的 Node 22.x）

## 安装依赖

```bash
cd VideoFlow
# Electron 二进制较大，国内网络建议走镜像
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

## 开发运行（不打包，直接起窗口）

```bash
npm start
```

首次打开后，点右上角「⚙ 设置」填入三个通道的密钥即可使用：

| 通道 | 需要填 | 用途 |
|---|---|---|
| 火山方舟 Seedance | API Key | 视频生成（含顺序衔接、Seedance 2.0） |
| OpenAI | API Key | 角色图 / 关键帧 |
| 火山 TTS | AppId + Access Token | 配音 |

## 打包成 .dmg 安装包

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

产物在 `release/`（已 gitignore）。生成的 `.dmg` 拖入「应用程序」即可安装。

### 关于签名（当前为「可跑原型」阶段，未签名）

未做 Apple 代码签名/公证，用户首次打开会被 Gatekeeper 拦「来自身份不明的开发者」。绕过方式：
- **右键点 App → 打开**，在弹窗里再点「打开」；或
- 系统设置 → 隐私与安全性 → 「仍要打开」。

若日后要正式对外分发，需 Apple Developer 账号（$99/年）做签名 + 公证，再在 `package.json > build.mac` 里补 `identity` / `notarize` 配置。

## 已知限制

- 视频「顺序衔接」/图生视频需要把本机关键帧暴露成公网可达 URL（`publicBaseUrl`）。桌面版同样要用户自行开隧道（如 cloudflared）并在设置里填该地址——这与网页/本地运行时一致。
- `node:sqlite` 目前是 Node 实验特性，启动带 `--experimental-sqlite`，会有一条 ExperimentalWarning，属正常。
