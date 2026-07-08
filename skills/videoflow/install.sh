#!/usr/bin/env bash
# VideoFlow · 一键安装 / 探活脚本
# 用法: bash skills/videoflow/install.sh
# 作用: 全局软链 videoflow 命令 → 启动检查后端 → 打印给 Agent 用的接入包路径
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI_DIR="$REPO/cli"
BRIEF="$REPO/skills/videoflow/AGENT_BRIEF.md"
BASE="${VIDEOFLOW_BASE:-http://localhost:8080/v1}"

echo "▶ VideoFlow 仓库: $REPO"

# 1) Node 版本
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node，请先安装 Node.js ≥ 18.17"; exit 1
fi
echo "✓ node $(node -v)"

# 2) 全局软链 videoflow
echo "▶ npm link (cd $CLI_DIR)"
( cd "$CLI_DIR" && npm link >/dev/null 2>&1 ) && echo "✓ 已软链 videoflow"

# 定位可执行文件（PATH 里找不到时回退到 npm 全局 bin）
VF_BIN="$(command -v videoflow 2>/dev/null || true)"
if [ -z "$VF_BIN" ]; then
  VF_BIN="$(npm prefix -g)/bin/videoflow"
fi
if [ ! -e "$VF_BIN" ]; then
  echo "✗ 软链失败，找不到 videoflow 可执行文件"; exit 1
fi
echo "✓ videoflow → $VF_BIN ($("$VF_BIN" version))"

PREFIX_BIN="$(dirname "$VF_BIN")"
case ":$PATH:" in
  *":$PREFIX_BIN:"*) : ;;
  *) echo "⚠ $PREFIX_BIN 不在当前 PATH，请确保已加入 shell rc（新开终端或 source 后生效）" ;;
esac

# 3) 后端探活
echo "▶ 探活后端 $BASE"
if "$VF_BIN" health --json >/dev/null 2>&1; then
  echo "✓ 后端在线"
  "$VF_BIN" health --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);for(const[k,v]of Object.entries(j.channels||{}))console.log(`    ${k.padEnd(8)} ${v.ready?"✓ ready":"✗ 未配置"}`)})'
else
  echo "⚠ 后端未响应。请在另一个终端启动：  node $REPO/server/server.js"
fi

echo ""
echo "════════════════════════════════════════════════"
echo " 安装完成。发给 Agent 的接入包（把整份内容贴给它）："
echo "   $BRIEF"
echo " 或让 Agent 读取: cat $BRIEF"
echo "════════════════════════════════════════════════"
