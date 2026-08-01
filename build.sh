#!/bin/bash
set -e
BUILD_DATE=$(TZ=Asia/Shanghai date +%y.%m.%d.%H.%M)
GIT_COMMIT=$(git rev-parse --short HEAD)
VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo 'unknown')
VERSION=${VERSION}-${BUILD_DATE}
COMPOSE_FILES="-f docker-compose.dev.yml"
[ -f docker-compose.dev.override.yml ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.dev.override.yml"

# 在宿主机构建前端（利用持久化 .next 缓存，增量构建仅需 20-30s）
echo ""
echo "━━━ 宿主机构建前端 ━━━"
NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmmirror.com}
(cd frontend && \
  npm install --registry "$NPM_REGISTRY" && \
  NEXT_PUBLIC_API=${NEXT_PUBLIC_API:-http://localhost:9092} \
  NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE \
  npm run build -- --no-lint)
echo "━━━ 前端构建完成 ━━━"
echo ""

BUILD_DATE=$BUILD_DATE GIT_COMMIT=$GIT_COMMIT VERSION=$VERSION \
  docker compose $COMPOSE_FILES --env-file .env.dev up -d --build
