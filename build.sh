#!/bin/bash
# singbox-dashboard 构建脚本
# 用法: ./build.sh [up|build] [--no-cache]

set -e

# 时间戳 tag: yy.mm.dd.hh.mm
export TAG=$(date +%y.%m.%d.%H.%M)
# Git commit ID
export GIT_COMMIT=$(git rev-parse --short HEAD)

# 本地开发可用镜像加速，CI 自动用标准镜像
export GO_IMAGE="${GO_IMAGE:-golang:1.25-alpine}"
export NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"

echo "=========================================="
echo "  singbox-dashboard 构建"
echo "  TAG:       ${TAG}"
echo "  GIT_COMMIT: ${GIT_COMMIT}"
echo "  GO_IMAGE:  ${GO_IMAGE}"
echo "=========================================="

ACTION=${1:-up}
if [ "$ACTION" = "build" ]; then
  docker compose build ${2:-}
else
  docker compose up -d --build ${2:-}
fi

echo ""
echo "构建完成: ${TAG} (${GIT_COMMIT})"
