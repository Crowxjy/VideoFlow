#!/usr/bin/env bash
# ===================================================================
# VideoFlow · Mac 本地启动脚本
# -------------------------------------------------------------------
# 用法:
#   bash scripts/mac-start.sh            # 正常启动 GUI (npm start)
#   bash scripts/mac-start.sh --check    # 启动并跑 GUI Token 注入自检，跑完退出并打印结论
#   bash scripts/mac-start.sh --keep     # 自检模式但保留窗口(自检结论照常打印)
#
# 也可直接双击 start.command（等价于无参数运行本脚本）。
# 首次运行会自动 npm install（Electron 二进制走国内镜像）。
# ===================================================================
set -euo pipefail

# 定位仓库根（脚本在 scripts/ 下）
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "▶ VideoFlow 仓库: $REPO"

# 1) Node 检查
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node，请先安装 Node.js（≥ 18 即可，运行时用 Electron 内置 Node）"
  exit 1
fi
echo "✓ node $(node -v)"

# 2) 依赖检查（缺 electron 就装；走国内镜像加速二进制下载）
if [ ! -x "node_modules/.bin/electron" ]; then
  echo "▶ 未检测到 Electron，开始安装依赖（首次较慢，二进制约 100MB）…"
  export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
  export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
  npm install
else
  echo "✓ Electron 已就绪 ($(node_modules/.bin/electron --version 2>/dev/null || echo '版本未知'))"
fi

# 3) 解析参数
MODE="normal"
for a in "$@"; do
  case "$a" in
    --check) MODE="check" ;;
    --keep)  MODE="keep" ;;
    *) echo "⚠ 忽略未知参数: $a" ;;
  esac
done

# 4) 启动
case "$MODE" in
  check)
    echo "▶ 启动 GUI 自检模式（验证 Token 注入，跑完自动退出）…"
    echo "──────────────────────────────────────────────"
    VF_SELFCHECK=1 npm start
    code=$?
    echo "──────────────────────────────────────────────"
    if [ $code -eq 0 ]; then echo "✅ 自检通过（退出码 0）"; else echo "❌ 自检失败（退出码 $code），请看上方 FAIL 项"; fi
    exit $code
    ;;
  keep)
    echo "▶ 启动 GUI 自检模式（保留窗口，自检结论见控制台）…"
    VF_SELFCHECK=1 VF_SELFCHECK_KEEP=1 npm start
    ;;
  *)
    echo "▶ 启动 VideoFlow 桌面版…"
    npm start
    ;;
esac
