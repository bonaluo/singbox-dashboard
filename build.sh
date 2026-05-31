#!/bin/bash
# singbox-dashboard 构建脚本
# 用法:
#   ./build.sh                        # 构建所有服务并启动
#   ./build.sh up                     # 同上
#   ./build.sh frontend               # 只构建并启动前端
#   ./build.sh backend                # 只构建并启动后端
#   ./build.sh build                  # 只构建镜像不启动
#   ./build.sh build frontend         # 只构建前端镜像
#
# 镜像加速（默认开启，CI 环境自动跳过）:
#   ./build.sh                        # 本地自动用镜像加速
#   CI=true ./build.sh                # CI 环境用官方源

set -e

# 时间戳 tag: yy.mm.dd.hh.mm
export TAG=$(date +%y.%m.%d.%H.%M)
export GIT_COMMIT=$(git rev-parse --short HEAD)

# CI 环境用官方源，本地开发用镜像加速
if [ "${CI}" = "true" ]; then
  export GO_IMAGE="${GO_IMAGE:-golang:1.25-alpine}"
  export NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"
  export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
else
  export GO_IMAGE="${GO_IMAGE:-docker.m.daocloud.io/library/golang:1.25-alpine}"
  export NODE_IMAGE="${NODE_IMAGE:-docker.m.daocloud.io/library/node:22-alpine}"
  export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
fi

echo "=========================================="
echo "  singbox-dashboard 构建"
echo "  TAG:          ${TAG}"
echo "  GIT_COMMIT:   ${GIT_COMMIT}"
echo "  GO_IMAGE:     ${GO_IMAGE}"
echo "  NODE_IMAGE:   ${NODE_IMAGE}"
echo "  NPM_REGISTRY: ${NPM_REGISTRY}"
echo "=========================================="

ACTION=${1:-up}
SERVICE=${2:-}

case "${ACTION}" in
  up)
    if [ -n "${SERVICE}" ]; then
      docker compose up -d --build "${SERVICE}"
    else
      docker compose up -d --build
    fi
    ;;
  build)
    if [ -n "${SERVICE}" ]; then
      docker compose build "${SERVICE}"
    else
      docker compose build
    fi
    ;;
  frontend|backend)
    docker compose up -d --build "${ACTION}"
    ;;
  *)
    echo "用法: ./build.sh [up|build|frontend|backend] [service]"
    exit 1
    ;;
esac

echo ""
echo "构建完成: ${TAG} (${GIT_COMMIT})"
