#!/bin/bash
# singbox-dashboard 构建脚本
# 用法: ./build.sh [up|build] [--no-cache]

set -e

# 时间戳 tag: yy.mm.dd.hh.mm
export TAG=$(date +%y.%m.%d.%H.%M)
# Git commit ID
export GIT_COMMIT=$(git rev-parse --short HEAD)

echo "=========================================="
echo "  singbox-dashboard 构建"
echo "  TAG:       ${TAG}"
echo "  GIT_COMMIT: ${GIT_COMMIT}"
echo "=========================================="

ACTION=${1:-up}
if [ "$ACTION" = "build" ]; then
  docker compose build ${2:-}
else
  # 默认: 构建并启动
  docker compose up -d --build ${2:-}
fi

echo ""
echo "构建完成: ${TAG} (${GIT_COMMIT})"
