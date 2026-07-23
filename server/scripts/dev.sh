#!/usr/bin/env bash
# dev.sh — 开发环境启动脚本
set -e

echo "=== MyOpenClaw 开发模式启动 ==="
export NODE_ENV=development
pnpm dev
