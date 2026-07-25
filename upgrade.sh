#!/usr/bin/env bash
#
# SmartTavern 升级脚本
# 用法: 在 SmartTavern 安装根目录下执行 bash upgrade.sh
#
# 功能: 删除所有应用文件（前端、后端源码/构建产物、配置模板、依赖等），
#       但保留运行时数据与用户配置，使得解压新版发布包即可完成升级。
#
# 保留的内容（不会被删除）:
#   backend/.env        - 环境变量配置（密钥、端口等）
#   backend/data/       - 用户数据（角色卡、世界书、对话、系统配置）
#   backend/uploads/    - 上传文件
#   backend/backups/    - 备份
#   backend/logs/       - 日志
#

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# 确定安装根目录（脚本所在目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "=========================================="
echo " SmartTavern 升级清理"
echo " 工作目录: $SCRIPT_DIR"
echo "=========================================="
echo ""

# 检查是否在正确的目录
if [[ ! -d "backend" && ! -d "frontend" ]]; then
    error "当前目录下未找到 backend/ 或 frontend/，请确认在 SmartTavern 安装根目录下执行。"
    exit 1
fi

# ---- 保留列表（仅做提示，不操作） ----
info "以下内容将被保留:"
PRESERVE_LIST=(
    "backend/.env"
    "backend/data"
    "backend/uploads"
    "backend/backups"
    "backend/logs"
)
for item in "${PRESERVE_LIST[@]}"; do
    if [[ -e "$item" ]]; then
        ok "  $item (存在，保留)"
    else
        info "  $item (不存在，跳过)"
    fi
done
echo ""

# ---- 确认 ----
read -rp "$(echo -e "${YELLOW}确认要删除所有应用文件吗？(y/N): ${NC}")" confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    info "已取消。"
    exit 0
fi
echo ""

# ---- 删除应用文件 ----
info "开始清理应用文件..."

# 前端目录
if [[ -d "frontend" ]]; then
    rm -rf frontend
    ok "已删除 frontend/"
fi

# 后端 - 仅删除应用文件，保留运行时数据
if [[ -d "backend" ]]; then
    # 删除源码和构建产物
    [[ -d "backend/src" ]]  && rm -rf backend/src  && ok "已删除 backend/src/"
    [[ -d "backend/dist" ]] && rm -rf backend/dist && ok "已删除 backend/dist/"

    # 删除依赖
    [[ -d "backend/node_modules" ]] && rm -rf backend/node_modules && ok "已删除 backend/node_modules/"

    # 删除测试覆盖率
    [[ -d "backend/coverage" ]] && rm -rf backend/coverage && ok "已删除 backend/coverage/"

    # 删除配置/元数据文件（不删 .env）
    for f in package.json package-lock.json tsconfig.json jest.config.js .env.example; do
        [[ -f "backend/$f" ]] && rm -f "backend/$f" && ok "已删除 backend/$f"
    done
fi

# 根目录依赖
if [[ -d "node_modules" ]]; then
    rm -rf node_modules
    ok "已删除 node_modules/"
fi

# 根目录文件
for f in package.json package-lock.json .gitignore INSTALL.md LICENSE README.md; do
    [[ -f "$f" ]] && rm -f "$f" && ok "已删除 $f"
done

# 旧版升级脚本自身（新版解压会覆盖）
# 注意：不在这里删除自身，解压时会自动覆盖

# 清理可能残留的临时文件（注意：-o 需用括号分组，否则 -maxdepth 只作用于第一个条件）
find . -maxdepth 3 \( -name "*.log" -o -name "*.tmp" -o -name "*.bak" -o -name "*.temp" -o -name "*.cache" -o -name "*.pid" -o -name ".DS_Store" -o -name "Thumbs.db" -o -name "desktop.ini" \) 2>/dev/null | while read -r f; do
    rm -f "$f"
done

echo ""
echo "=========================================="
echo -e " ${GREEN}升级清理完成！${NC}"
echo ""
echo " 接下来请解压新版发布包到当前目录:"
echo "   unzip SmartTavern-vX.X.X.zip"
echo "   cp -r SmartTavern-vX.X.X/* ."
echo "   rm -rf SmartTavern-vX.X.X"
echo ""
echo " 然后安装依赖并启动:"
echo "   npm run install:all"
echo "   npm run start:backend"
echo "=========================================="
