# videoflow-cli

把 VideoFlow 后端 (REST + SSE) 包装成命令行工具，方便第三方 Agent (Trae / Claude / 自研) 通过 `spawn` 直接驱动整套创作流。

## 前置

1. 启动 VideoFlow 后端：
   ```bash
   node server/server.js
   # 默认 http://localhost:8080
   ```
2. Node ≥ 18.17（用到内置 `fetch` / `ReadableStream`）。

## 安装

```bash
# 方式 A：全局软链
cd cli && npm link
videoflow help

# 方式 B：直接执行
node /path/to/VideoFlow/cli/videoflow.mjs help
```

## 配置

| 参数 | 来源（优先级从高到低） | 默认值 |
|---|---|---|
| `--base=<url>` | flag → `VIDEOFLOW_BASE` env | `http://localhost:8080/v1` |
| `--token=<tok>` | flag → `VIDEOFLOW_TOKEN` env | `""`（默认后端不鉴权） |
| `--project=<pid>` | flag → `VIDEOFLOW_PID` env → 持久化到 `~/.videoflow-cli.json` | — |
| `--json` | flag | 关闭（默认人类可读） |

`videoflow projects use <id>` 会把当前项目写到 `~/.videoflow-cli.json`，后续命令免参。

## Agent 集成范式（最短路径）

```bash
# 1. 探活
videoflow health --json

# 2. 新建并切换项目
videoflow projects create "新春广告" --json
# 上一步会自动 use，无需再 use

# 3. 流式对话补全需求
videoflow chat send "30 秒，TikTok 投放，目标 Z 世代" --json

# 4. 生成脚本
videoflow script generate --json

# 5. 提交全部素材任务
videoflow gen submit --json

# 6. 轮询任务直到全部 done
videoflow gen tasks --status=done --json

# 7. 导出剪辑清单
videoflow export > cut.json
```

所有命令加 `--json` 后输出严格 JSON，Agent 可直接解析。

## 命令速览

```
health
config show

projects list | create <name> [--aspect=16:9 --lang=zh]
projects use <id> | show [<id>] | delete <id>

brief get | set <key> <value> | delete <key>
chat send <text> | history
script generate | show

characters list
scenes list
generic list | upload <file> [--name --type --desc] | delete <id>

gen submit | tasks [--status=...] | task <id> | retry <id> | cancel <id>
export
settings get | set <group.key> <value>
```

完整说明：`videoflow help`。

## 与 Trae Skill 协同

`skills/videoflow/SKILL.md` 已声明本 CLI 为推荐入口，Trae Agent 启用 Skill 后即可发现并调用。
