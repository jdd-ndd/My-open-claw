#!/usr/bin/env bash
# bootstrap.sh — 项目初始化引导脚本
set -e

echo "=== MyOpenClaw 初始化引导 ==="

# 检查 Node.js 版本
echo "[1/5] 检查 Node.js 版本..."
node -v | grep -q "v20" || { echo "请安装 Node.js 20 LTS"; exit 1; }

# 启用 pnpm
echo "[2/5] 配置 pnpm..."
corepack enable
corepack prepare pnpm@latest --activate

# 安装依赖
echo "[3/5] 安装项目依赖..."
pnpm install

# 复制环境变量
echo "[4/5] 配置环境变量..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  已创建 .env 文件，请编辑配置 LLM API Key"
fi

# 构建项目
echo "[5/5] 构建项目..."
pnpm build

echo ""
echo "=== 初始化完成 ==="
echo "运行 pnpm dev 启动开发服务"
