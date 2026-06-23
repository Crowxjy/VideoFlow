# AI 视频工作台 · VideoFlow

面向企业的 AI 视频生产工作台。围绕「**需求对话 → 脚本故事板 → 素材生成 → 剪辑成片**」四步主动线，覆盖产品发布宣传片 / 商务 Pitch 视频等企业级场景。

本仓库包含两部分：

- **前端**：零构建（no-build）静态站点，纯 HTML + 原生 JS + CSS。可 `file://` 直开体验（离线），也可由后端同源托管走真实接口。
- **后端**：零 npm 依赖的真实服务（`node:http` + `node:sqlite`），**数据持久化、异步生成任务队列真实落盘**，重启不丢。模型调用通过可替换的 **Provider 适配层**，默认产出真实可访问的占位文件，接真实模型只需改一个文件。

---

## 1. 快速开始

### 方式 A：离线直开（零依赖，先看效果）

直接用浏览器打开 `index.html`：

```bash
open index.html          # macOS
```

前端读取 `data.js` 中的 `window.DB`，所有视图、生成队列动画、抽屉交互均可体验，**无需任何服务**。

### 方式 B：真实后端（推荐，数据持久化 + 真实异步生成）

需要 **Node 22.5+**（内置 `node:sqlite`；本项目在 Node 24 验证）。

```bash
node server/server.js
# [VideoFlow] 真实后端已启动 → http://localhost:8080
# [VideoFlow] 前端（同源） → http://localhost:8080/   API → http://localhost:8080/v1
# [VideoFlow] Provider=local  鉴权=关  并发=2
```

然后浏览器打开 **http://localhost:8080/**（由后端同源托管前端，避免 `file://` 的 CORS / 路径问题）。前端检测到经 http 托管会**自动切到在线接口**（`<origin>/v1`），无需手动切换。

- 数据库文件落盘在 `data/videoflow.db`（首次启动自动建表 + 注入与 `data.js` 同构的种子数据），**重启不丢**。
- 生成产物（SVG / 图 / 视频）落盘在 `media/`，通过 `/media/*` 同源访问。
- 提交生成任务后，服务端任务队列真实执行 `queued → running → done`，关键帧产物自动挂回对应分镜。

> 控制台手动切换数据源：`API.useRemote("http://host:8080/v1"[, token])` / `API.useLocal()`。
> baseURL / token / 项目 ID 记忆在 `localStorage`（`vf_api` / `vf_token` / `vf_pid`），刷新保持。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口。 |
| `VF_TOKEN` | 空 | 设置后开启 Bearer 鉴权（前端用 `API.setToken("...")` 或 `useRemote(url, token)`）；为空则放行，便于本地开发。 |
| `VF_PROVIDER` | `local` | `local`=本地占位产物（真实写文件）；`real`=启用 `RealProvider`，按 kind 路由到真实模型。 |
| `VF_DB` | `data/videoflow.db` | SQLite 数据库路径（`:memory:` 可用内存库）。 |
| `VF_CONCURRENCY` | `2` | 生成队列并发上限。 |

> 接真实模型相关的所有 API Key / 端点 / 模型名都在**页面内的「⚙ 设置」抽屉**配置，运行时落盘到 `data/settings.json`，修改即时生效、重启不丢。无需重启进程、无需写代码。下方表格里的 env 仅用于首次启动的种子值。

### 接入真实模型（VF_PROVIDER=real）

启动 `VF_PROVIDER=real node server/server.js`，在浏览器打开 `http://localhost:8080/`，右上角点 **⚙ 设置**。当前已接入：

| 素材类型（kind） | 厂商 / 模型 | 必填字段 |
| --- | --- | --- |
| `char_ref` · `keyframe`（角色参考图 / 关键帧） | OpenAI 文生图（默认 `gpt-image-1`） | API Key |
| `video` · `fx`（视频片段 / 动效） | 字节火山方舟 Seedance（默认 `doubao-seedance-1-0-pro-250528`） | API Key |
| `voice`（配音） | 字节火山引擎大模型 TTS | AppId + Access Token |
| 需求对话（流式 SSE，自动抽取 brief） | 豆包 / OpenAI Chat（任选） | API Key + 模型 ID（Key 可复用对应厂商组） |

未在表中的素材类型尚未接入真实模型，在 `real` 模式下提交会直接失败（不会静默回退到占位），避免误判结果。Seedance 图生视频如需把本地参考图传给模型侧，请在「设置 → 火山方舟 → 外网回调 Base URL」填入公网可达地址（如反向代理 / ngrok）。

env 种子值（首次启动会被读入 `settings.json`，之后以页面内编辑为准）：

| 变量 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_IMAGE_MODEL` / `OPENAI_IMAGE_SIZE` | OpenAI 图像 |
| `ARK_API_KEY` / `ARK_BASE_URL` / `ARK_VIDEO_MODEL` / `ARK_VIDEO_RATIO` / `ARK_VIDEO_DURATION` / `VF_PUBLIC_BASE_URL` | 火山方舟 Seedance |
| `VOLC_TTS_APPID` / `VOLC_TTS_TOKEN` / `VOLC_TTS_VOICE` / `VOLC_TTS_CLUSTER` / `VOLC_TTS_SPEED` | 火山 TTS |

---

## 2. 目录结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 应用骨架：左侧导航 + 主舞台 + 右侧抽屉，按序加载 `data.js → api.js → app.js`。 |
| `styles.css` | 设计系统（Linear 风格暗色主题、CSS 变量、组件样式、动效）。 |
| `data.js` | 离线 Mock 数据 `window.DB`，与后端结构同构，作为 `file://` 直开的数据源 / 降级源。 |
| `api.js` | **API 客户端层**：统一封装读写，自动在「离线 DB」与「在线 HTTP」间切换；含超时、幂等重试、鉴权、同源自动接管。 |
| `app.js` | 应用逻辑：路由、四大视图渲染、素材库 / Prompt 编辑抽屉、生成队列、Toast。 |
| `server/server.js` | **真实后端入口**：`node:http` 路由 + 同源托管前端与 `/media` 产物 + 鉴权；REST 契约见 `openapi.yaml`。 |
| `server/db.js` | **数据库层**（`node:sqlite`）：建表 + 种子数据 + DAO，持久化到 `data/videoflow.db`。 |
| `server/queue.js` | **异步生成任务队列**：并发调度 `queued→running→done/failed`，产物挂回分镜，完成回调 webhook。 |
| `server/providers.js` | **模型适配层**：`LocalProvider`（默认，真实写文件）/ `RealProvider`（接真实模型时改这里）。 |
| `openapi.yaml` | OpenAPI 3.1 接口契约。 |
| `schema.sql` | PostgreSQL 数据库 DDL 参考（后端 SQLite 与之字段对齐）。 |
| `types.ts` | 领域 TypeScript 类型定义。 |
| `assets/` | SVG 占位素材（关键帧、角色、场景参考图等）。 |
| `data/` `media/` | 运行时生成：SQLite 库 / 产物文件（不入库，首次启动自动创建）。 |

---

## 3. 数据流与架构

四步主动线对应数据模型的逐级生成，核心链路：

```
Project ── Brief ── Script ── SceneNode ── Shot ── Prompt ── GenTask ── Media
   │                                │                                      │
   │                                └── 引用 ──┐                            │
   └── Character / Scene / GenericAsset 资产库 ┘            Timeline ── Track ── Clip（P1）
```

运行时架构（在线模式）：

```
            ┌──────────────┐   fetch(GET/POST/PUT/PATCH)   ┌──────────────────────────────┐
  视图 view ─┤ api.js (API) ├───────────────────────────────►│ server/server.js (node:http) │
 (app.js)  └──────┬───────┘   超时/幂等重试/Bearer         │   /v1/... · /media/* · 同源前端 │
                  │  isRemote()?                            └───────┬─────────────┬────────┘
        离线 ◄────┘  └────► 在线                                    │             │
   window.DB(data.js)        HTTP                          db.js(sqlite)    queue.js
                                                          data/videoflow.db   │
                                                          （持久化，重启不丢）  ▼
                                                                       providers.js
                                                                  LocalProvider → media/*.svg
                                                                  RealProvider  → 真实模型
```

- **离线分支**：`API.getX()` 直接返回 `window.DB` 切片，与远端响应**同构**，视图代码无需区分来源。
- **在线分支**：`API.getX()` 发起 `fetch`，GET 幂等请求在 429/5xx/网络抖动时自动重试（退避），401/403 抛「未授权」。
- **真实异步生成**：`POST /gen-tasks` 入库即返回 `202`，队列按并发上限拉起，调用 `provider.generate()` 产出真实文件、写 `media` 表、关键帧挂回分镜；前端轮询 `GET /gen-tasks/{id}` 刷新进度。重启时历史 `running` 任务复位为 `queued` 重新拉起，避免卡死。

---

## 4. 四步主动线

| 步骤 | 视图 | 关键能力 |
| --- | --- | --- |
| 01 需求对话 | `viewBrief` | 多轮对话澄清需求，实时维护「需求单」字段与完整度；信息足够后一键生成脚本。 |
| 02 脚本故事板 | `viewScript` | 按幕展示场景 / 角色 / 动效 / 文案 + 三类 Prompt（角色参考图、关键帧、动效），可逐条编辑微调，单幕或一键生成全部素材。 |
| 03 素材生成 | `viewGen` | 关键帧 / 视频片段 / 动效以异步任务执行，队列实时展示进度、概览统计，支持重试与多版本择优。 |
| 04 剪辑成片（P1） | `viewEditor` | 按幕序自动拼接片段、添加转场，由脚本文案一键生成配音 / 字幕，多轨时间轴修剪。 |

辅助能力：**项目素材库抽屉**（角色 / 场景 / 通用素材），角色形象支持「锁定」以保证跨分镜一致性。

---

## 5. 接口一览

完整契约见 `openapi.yaml`；`api.js` 暴露的客户端方法与对应路由：

### 读

| 客户端方法 | HTTP |
| --- | --- |
| `API.getProject()` | `GET /projects/{id}` |
| `API.getBrief()` | `GET /projects/{id}/brief` |
| `API.getDialogue()` | `GET /projects/{id}/dialogue` |
| `API.getScript()` | `GET /projects/{id}/script` |
| `API.getCharacters()` | `GET /projects/{id}/characters` |
| `API.getScenes()` | `GET /projects/{id}/scenes` |
| `API.getGeneric()` | `GET /projects/{id}/generic` |
| `API.getTasks(status?)` | `GET /gen-tasks?projectId={id}[&status=]` |
| `API.getTimeline()` | `GET /projects/{id}/timeline` |

### 写 / 异步

| 客户端方法 | HTTP |
| --- | --- |
| `API.sendMessage(text)` | `POST /projects/{id}/dialogue` → `{ reply, brief }` |
| `API.submitGen(items)` | `POST /gen-tasks` → `202` 任务列表 |
| `API.pollTask(id)` | `GET /gen-tasks/{id}` |
| `API.retryTask(id)` | `POST /gen-tasks/{id}:retry` |
| `API.cancelTask(id)` | `POST /gen-tasks/{id}:cancel` |
| `API.lockCharacter(id)` | `POST /characters/{id}:lock` |
| `API.savePrompts(sceneNodeId, prompts)` | `PUT /scenes/{sceneNodeId}/prompts` |
| `API.exportFilm()` | `POST /projects/{id}/export` → 导出任务 |

数据源 / 鉴权切换：`API.isRemote()` / `API.getBase()` / `API.getPid()` / `API.hasToken()` / `API.useRemote(url, token?)` / `API.useLocal()` / `API.setToken(tok)` / `API.setPid(pid)`。

---

## 6. 接入真实模型

模型调用与业务 / 队列彻底解耦：业务层只调 `provider.generate(kind, payload) → { url, mime, width, height, duration_s, has_alpha }`。接真实模型**只改 `server/providers.js` 的 `RealProvider`**，其它代码零改动，然后 `VF_PROVIDER=real` 启动。

- 文生图 / 图生图（关键帧、角色参考图、动效首帧）：调用生图服务，返回可访问 `url`。
- 文生视频 / 图生视频（异步三步）：创建任务 → 轮询 `task_id` → 拿下载 URL，在 `generate` 内完成轮询后 `return` 最终 `url`。
- TTS 配音：调用 TTS，返回音频 `url` 与时长。

> 安全约定：**禁止在前端或本服务直连受控推理端点**；真实模型调用应由独立的、经审批的服务侧适配器承接，`RealProvider` 仅留接口形状。

---

## 7. 设计与技术约定

- **设计语言**：参考 Linear 暗色系；所有图标为内联 SVG（`app.js` 的 `ICON` 对象），不使用 emoji；严禁单侧描边，统一用 CSS 变量与 `color-mix` 控制色彩层级。
- **颜色变量**：`--accent:#7c6cff`、`--accent-2:#5b8cff`、`--ok/warn/danger`、`--bg-0..3`、`--txt-1/2/3` 等，集中定义于 `styles.css` 顶部。
- **零依赖后端**：仅用 Node 内置模块（`node:http` + `node:sqlite`），无需 `npm install`、无需编译。
- **零构建前端**：不依赖打包器 / 框架，原生 ES 模块化拆分，`file://` 即可运行。
- **占位规范**：未生成的素材以矩形占位区呈现，并在 Prompt 编辑抽屉给出对应生图 Prompt。

> 注：剪辑成片为 **P1** 能力，当前为交互原型；素材生成的真实模型对接由 `server/providers.js` 的 `RealProvider` 实现。
