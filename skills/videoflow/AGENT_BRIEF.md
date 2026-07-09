# VideoFlow · Agent 接入包（自包含，可直接粘贴给任意 Agent）

你（Agent）将通过命令行工具 `videoflow` 驱动 VideoFlow 视频创作后端，完成
「需求对话 → 脚本 → 素材（图/配音/视频）→ 剪辑清单」的全流程。本文件是唯一说明，
无需其它上下文。所有命令都支持 `--json`，**始终加 `--json` 并解析其 stdout**。

---

## 0. 在你自己的环境里从零就位（首次必做）

本工具链**不预装**在你的环境里，需要你自己拉取并自起后端。整套零 npm 依赖，只要
**Node ≥ 18.17**。按顺序执行：

```bash
# 前提检查：必须有 node ≥ 18.17 和 git
node -v && git --version

# 1) 拉取仓库（公开，无需鉴权）到工作目录
git clone https://github.com/Crowxjy/VideoFlow.git
cd VideoFlow
export VF_HOME="$(pwd)"          # 记住仓库根，后续都用它

# 2) 后台启动后端（默认 http://localhost:8080，SQLite 落到 data/，无需 npm install）
#    用 nohup / & 让它常驻，不要前台阻塞。
nohup node "$VF_HOME/server/server.js" > "$VF_HOME/server.log" 2>&1 &

# 3) 等待就绪并探活（轮询到 health 成功，最多 ~15 秒）
for i in $(seq 1 15); do
  node "$VF_HOME/cli/videoflow.mjs" health --json >/dev/null 2>&1 && break
  sleep 1
done
node "$VF_HOME/cli/videoflow.mjs" health --json
```

- **调用命令的方式**：自装环境**不必** `npm link`，直接
  `node "$VF_HOME/cli/videoflow.mjs" <命令> --json`。下文为简洁写作 `videoflow`，
  你实际执行时替换成 `node "$VF_HOME/cli/videoflow.mjs"`（或先 `cd "$VF_HOME/cli" && npm link` 再用 `videoflow`）。
- **探活返回**：`{ channels: { openai/ark/volcTts/chat: { ready, kinds } } }`，`ready` 表示该
  后端通道是否配了 Key。**没配没关系**——本工具设计成通道没就绪时自动降级（见第 1 节），
  你自带的能力优先。
- 若 `git clone` 或 `node` 缺失、无法联网：改用离线包或远程后端方案，回头找用户确认。
- 全局参数（可选）：`--base=<url>`、`--token=<tok>`、`--project=<pid>`。本仓库后端默认**不鉴权**，
  无需 token。

## 1. 核心理念：能力优先交给你（宿主 Agent），后端兜底

按 **kind** 逐类协商。你能做的自己做，做不了或后端通道未配置时自动降级，**互不阻断**——
即使没有视频能力，也能交付「脚本 + 关键帧 + 配音 + 剪辑清单」。

| 环节 | 你优先做（自带模型/能力） | 后端兜底（需对应通道 ready） |
|------|--------------------------|------------------------------|
| 需求对话 | `chat plan` → 你产出 JSON → `chat apply` | `chat send`（需 chat 通道） |
| 脚本 | `script plan` → 你产出 JSON → `script apply` | `script generate`（需 chat 通道） |
| 角色图/关键帧 | `gen plan` → 你出图 → `gen ingest` | `gen submit`（需 openai 通道） |
| 配音 | `gen plan` → 你出音频 → `gen ingest` | `gen submit`（需 volcTts 通道） |
| 视频/动效 | `gen plan` → 你出视频 → `gen ingest` | `gen submit`（需 ark 通道） |

## 2. 标准闭环

```bash
# 探活
videoflow health --json

# 建项目（自动设为当前项目，后续命令免带 --project）
videoflow projects create "<项目名>" --json      # → { id, name, spec, ... }
```

### 2.1 需求对话（文本，优先你来）
```bash
videoflow chat plan "<用户这句话>" --json
# 返回 { system, user, schema:{reply,patch,chips}, brief, history, knownKeys }
```
你用**自己的模型**，按 `system`+`user` 生成一个 JSON：
```json
{ "reply": "给用户的自然中文回复(≤80字)",
  "patch": { "字段名": "字段值" },     // 字段名只能取自 knownKeys，没有新信息就留空 {}
  "chips": ["短标签1"] }               // 可空
```
写进文件后落库（会更新需求单并写入对话）：
```bash
videoflow chat apply --from=<reply.json> --json
# 或 inline：videoflow chat apply --reply='{"reply":"...","patch":{},"chips":[]}' --json
```
循环 plan→apply 直到 `brief.completeness == 100`。也可直接改字段：
`videoflow brief set <字段名> "<值>"`。

### 2.2 脚本（文本，优先你来）
```bash
videoflow script plan --json
# 返回 { system, user, schema, project, brief, characters }
```
按 `system` 里的 JSON 模板用自己的模型产出完整脚本（必须含 `scenes` 数组），写文件后：
```bash
videoflow script apply --from=<script.json> --json    # → 落库并返回 { scenes:[...] }
```
（没有自带 LLM 时，退回 `videoflow script generate --json`，需后端 chat 通道 ready。）

> **逐镜参数（可选）**：每一幕可单独覆盖图片尺寸 / 视频画幅比例·分辨率·时长，未设则回退全局设置默认。
> 在脚本 JSON 的某幕里带 `params` 即可随 `script apply` 一起落库；也可事后单独设置：
> ```jsonc
> // 某幕节点：留空字段表示跟随全局默认
> { "id": "sn_xxx", "title": "开场", "params": {
>     "imgSize": "1024x1792", "videoRatio": "9:16",
>     "videoResolution": "1080p", "videoDurationS": 8 } }
> ```
> 单独读写：`GET /scenes/{id}/params`、`PATCH /scenes/{id}/params`（空串=恢复默认，仅传的字段才改）。
> 生成时后端按 `(kind, refId)` 自动注入到对应任务：keyframe 用 `imgSize`；video/fx 用比例·分辨率·时长。

### 2.3 媒体（图/配音/视频，能做的你做，其余后端兜底）
```bash
videoflow gen plan --json
# 返回 { items:[ { kind, refId, prompt, backendReady, backendChannel, ... } ], channelStatus }
# kind ∈ char_ref | keyframe | fx | video | voice
```
对你**有能力**的 kind，用 `prompt` 生成媒体文件到本地，写一份 manifest：
```json
{ "items": [
  { "kind": "char_ref", "refId": "c_anna", "file": "./anna.png" },
  { "kind": "keyframe", "refId": "sn_xxx", "file": "./kf1.png", "width": 1024, "height": 1536 },
  { "kind": "voice",    "refId": "sn_xxx", "file": "./vo1.mp3", "durationS": 4 }
] }
```
> `refId` 直接用 `gen plan` 每个 item 里给的值。
批量回写并自动绑定到分镜/角色：
```bash
videoflow gen ingest --from=<manifest.json> --json    # → { ingested, failed, results }
```
剩下你做不了的，交后端兜底（自动跳过你已 ingest 的、以及未配置通道的 kind）：
```bash
videoflow gen submit --json
# 返回 { submitted, skipped, skippedDetail:[{kind,refId,reason}], created }
# reason: already-done（你已交付）| channel-not-ready(<channel>)（后端没配）| not-in-kinds
# 可选：--kinds=keyframe,voice 只提交白名单；--force 无视通道就绪度强行提交
```
若 submit 有提交任务，轮询到全部完成：
```bash
videoflow gen tasks --json          # 每 3 秒一次，直到没有 queued/running
```

#### 顺序衔接生成（可选，视频专用）
需要「多个镜头画面连续承接」时，用顺序衔接模式：按幕序**串行**生成视频，把上一幕
视频的**尾帧**作为下一幕的**首帧**，本幕关键帧仍作画风参考。第一幕无首帧、仅用关键帧。
```bash
videoflow gen chain --json          # 按当前脚本各幕顺序提交视频链路任务
# 返回 { submitted, mode:"gen.chain", created:[...] }；随后照常 gen tasks 轮询
```
- **前置**：后端 `ark` 通道 ready，且模型为 **Seedance 2.0 系列**（多模态参考生视频；
  非 2.0 会降级为「尾帧作首帧」单图，无法并存关键帧参考）。通道未就绪加 `--force` 可强提。
- **与 `gen submit` 的区别**：submit 是并行、各幕独立；chain 是串行、幕间首尾帧衔接，较慢。
- 建议先 `gen submit`（或 ingest）产出各幕关键帧，再 `gen chain` 让画面连贯。

### 2.4 导出
```bash
videoflow export > cut.json         # ingest 与 submit 的产物统一聚合；视频缺失不阻断
```

> **资源包导入（.zip）**：把成片包或任意含图片/视频/音频的 zip 一键导入素材库。
> 二进制流 POST 到 `POST /projects/{id}/asset-pack:import`（Content-Type: application/zip）。
> 后端零依赖解压，按目录约定（videos/keyframes/character，兼容中文导出包）+ 扩展名归类。
> **智能回挂**（默认开）：按「NN_标题 / 角色名」把关键帧挂回分镜、角色图挂回角色、视频登记为该幕
> 完成产物；未匹配的落 generic_asset（可预览）。`?remap=0` 可关闭，全部当通用素材导入。
> 返回 `{ imported, bound, skipped, items, skippedDetail }`（bound=回挂数）。
> 非媒体文件（.md/.json）跳过。整包 ≤300MB，已做 Zip Slip / zip bomb 防护。

## 3. 错误码

`0` 成功；`1` 业务/网络错误（`--json` 下 stderr 输出 `{error,message,status,body}`）；`2` 用法错误。
常见：`ECONNREFUSED 8080` → 后端没起；`请求失败(401)` → 需 `--token`；`尚未设置项目 ID` → 先 create/use。

## 4. 命令速览

```
health | config show
projects { list | create <name> [--aspect=16:9 --lang=zh] | use <id> | show | delete <id> }
brief    { get | set <key> <value> | delete <key> }
chat     { send <text> | history | plan <text> | apply --from=<path>|--reply=<inline> }
script   { generate | show | plan | apply --from=<path> }
gen      { submit [--kinds=.. --force] | chain [--force] | plan | ingest --from=<manifest> | tasks [--status=..] | task <id> | retry <id> | cancel <id> }
characters list | scenes list | generic { list | upload <file> | delete <id> }
export | settings { get | set <group.key> <value> }
```
