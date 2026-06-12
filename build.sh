#!/bin/bash
# singbox-dashboard 本地开发构建脚本
# 用法: ./build.sh [backend|frontend]
# 构建本地镜像并启动（host 网络模式）

set -e

TAG="${TAG:-local}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse --short HEAD)}"
VERSION="${VERSION:-$(git describe --tags --abbrev=0 2>/dev/null || echo 'unknown')}"
export TAG GIT_COMMIT VERSION

# CI 环境用官方源，本地用镜像加速
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
echo "  singbox-dashboard 本地构建"
echo "  TAG:          ${TAG}"
echo "  VERSION:      ${VERSION}"
echo "  GIT_COMMIT:   ${GIT_COMMIT}"
echo "  GO_IMAGE:     ${GO_IMAGE}"
echo "  NODE_IMAGE:   ${NODE_IMAGE}"
echo "=========================================="

# 构建后端
build_backend() {
  echo "→ 构建 backend..."
  docker build \
    --platform linux/amd64 \
    --build-arg GIT_COMMIT="${GIT_COMMIT}" \
    --build-arg VERSION="${VERSION}" \
    --build-arg GO_IMAGE="${GO_IMAGE}" \
    --build-arg HTTP_PROXY="${HTTP_PROXY:-}" \
    --build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" \
    -t singbox-backend:"${TAG}" \
    ./backend
}

# 构建前端
build_frontend() {
  echo "→ 构建 frontend..."
  docker build \
    --platform linux/amd64 \
    --build-arg GIT_COMMIT="${GIT_COMMIT}" \
    --build-arg NODE_IMAGE="${NODE_IMAGE}" \
    --build-arg NPM_REGISTRY="${NPM_REGISTRY}" \
    -t singbox-frontend:"${TAG}" \
    ./frontend
}

# 启动 (host 网络, 本地镜像)
start() {
  echo "→ 启动容器..."

  # backend
  docker rm -f singbox-backend 2>/dev/null || true
  docker run -d \
    --name singbox-backend \
    --network host \
    -v "${DATA_DIR:-/mnt/g/docker/singbox-dashboard/data}":/data \
    -e TZ=Asia/Shanghai \
    -e SINGBOX_CONFIG=/data/sing-box-config.json \
    -e CLASH_API=http://127.0.0.1:9090 \
    -e DASHBOARD_DATA_DIR=/data \
    -e GIT_COMMIT="${GIT_COMMIT}" \
    --restart unless-stopped \
    singbox-backend:"${TAG}"

  # frontend
  docker rm -f singbox-frontend 2>/dev/null || true
  docker run -d \
    --name singbox-frontend \
    --network host \
    --hostname localhost \
    -e HOSTNAME=0.0.0.0 \
    -e PORT=9000 \
    -e NEXT_PUBLIC_GIT_COMMIT="${GIT_COMMIT}" \
    --restart unless-stopped \
    singbox-frontend:"${TAG}"
}

SERVICE="${1:-all}"

case "${SERVICE}" in
  backend)
    build_backend
    start
    ;;
  frontend)
    build_frontend
    start
    ;;
  all|"")
    build_backend
    build_frontend
    start
    ;;
  build-backend)
    build_backend
    ;;
  build-frontend)
    build_frontend
    ;;
  *)
    echo "用法: ./build.sh [backend|frontend|build-backend|build-frontend]"
    exit 1
    ;;
esac

echo ""
echo "构建完成: ${TAG} (${VERSION} ${GIT_COMMIT})"
echo "Dashboard: http://localhost:9000"
echo "API:       http://localhost:9092"
echo "Proxy:     socks5://localhost:2080"