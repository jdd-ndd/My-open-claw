#!/usr/bin/env bash
# start.sh — 生产环境启动脚本
set -e

echo "=== MyOpenClaw 生产模式启动 ==="
export NODE_ENV=production
node dist/index.js
