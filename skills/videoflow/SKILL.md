---
name: videoflow
version: 0.1.0
description: "VideoFlow（AI 视频工作台）外部 Agent 入口：通过 videoflow CLI 驱动从需求对话→脚本生成→素材批量生成→剪辑导出的完整流程。当用户希望让 Agent 自动创建视频项目、补全需求、生成脚本、批量生成角色/分幕/动效/视频/配音素材、查询生成进度、或导出剪辑清单 JSON 时使用本 Skill。前提：本机已运行 VideoFlow 后端（默认 http://localhost:8080），且已安装本仓库 cli/ 目录下的 videoflow 命令（`npm link` 或直接 `node /path/to/cli/videoflow.mjs`）。"
metadata:
  requires:
    bins: ["videoflow", "node"]
  cliHelp: "videoflow help"
---

# videoflow

**前置检查（开始任何 VideoFlow 工作流前必须确认）：**

1. 后端是否在跑：`videoflow health --json`，若返回非 0 或 fetch 失败，引导用户在仓库根目录执行 `node server/server.js`。
2. 模型通道是否就绪：`health` 输出的 `channels` 中至少 `chat` 通道 `ready: true`。否则提示用户在前端「设置」面板填写 API Key，或：
   ```bash
   videoflow settings set chat.apiKey <key>
   videoflow settings set chat.model doubao-1-5-pro-32k-250115
   ```
3. 当前项目：`videoflow config show` 查看记忆的 `projectId`。无则先 `projects create` 或 `projects use`。

**输出约定：所有命令加 `--json` 后输出严格 JSON，便于解析。**

## 标准工作流（推荐）

下面这条主路径覆盖 80% 的典型用例。其它命令查 `videoflow help`。

```bash
# 0. 探活
videoflow health --json

# 1. 创建项目（自动设为当前项目）
videoflow projects create "<项目名>" --json
# → { id: "p_xxx", name, spec, ... }

# 2. 用流式对话补全需求单
#    可循环多次直到 brief.completeness == 100
videoflow chat send "<用户对项目的描述>" --json
# → { reply, brief: { fields, completeness }, chips, patch }

# 3. 直接覆盖某个字段（可选）
videoflow brief set 视频类型 "30 秒短视频"

# 4. 生成完整脚本
videoflow script generate --json
# → { scenes: [...], global, characters, ... }

# 5. 提交所有素材生成任务
#    内部会按 scenes 拆出 char_ref / keyframe / fx / video 任务
videoflow gen submit --json
# → { submitted: N, items: [...] }

# 6. 轮询任务（建议每 3 秒一次直到全部 done 或 failed）
videoflow gen tasks --json

# 7. 导出剪辑清单
videoflow export > cut.json
```

## 关键命令清单

```
projects { list | create <name> [--aspect=16:9 --lang=zh] | use <id> | show | delete <id> }
brief    { get | set <key> <value> | delete <key> }
chat     { send <text> | history }
script   { generate | show }
gen      { submit | tasks [--status=...] | task <id> | retry <id> | cancel <id> }
generic  { list | upload <file> [--name --type --desc] | delete <id> }
settings { get | set <group.key> <value> }
export
health
```

## 错误处理

CLI 退出码：
- `0` 成功
- `1` 业务错误（含网络 / 后端报错；`--json` 模式下 stderr 输出 `{ error, message, status, body }`）
- `2` 用法错误（缺参 / 未知子命令）

常见情况：
- `connect ECONNREFUSED 127.0.0.1:8080` → 后端未启动。
- `请求失败(401)` → 后端启用了鉴权，需 `--token=<tok>` 或 `export VIDEOFLOW_TOKEN=...`。
- `尚未设置项目 ID` → 先 `projects create` 或 `projects use <id>`。

## 与本机数据的关系

- VideoFlow 后端把所有项目状态持久化到 `data/videoflow.db`，CLI 只是 HTTP 客户端，**不会绕过后端写库**。
- CLI 会在 `~/.videoflow-cli.json` 记忆当前项目 ID，跨会话保持。

## 不在本 Skill 范围

- 启动 / 停止后端：让用户自己 `node server/server.js`，避免端口冲突 / 生命周期问题。
- 视觉编辑（素材库画板、画幅预览）：必须在浏览器里完成，CLI 不模拟 UI。
- 直接合成最终视频：当前后端只导出**剪辑清单 JSON**（`videoflow export`），合成由下游工具完成。
