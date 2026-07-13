#!/bin/bash
set -e
BUILD_DATE=$(TZ=Asia/Shanghai date +%y.%m.%d.%H.%M)
GIT_COMMIT=$(git rev-parse --short HEAD)
VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo 'unknown')
VERSION=${VERSION}-${BUILD_DATE}
COMPOSE_FILES="-f docker-compose.dev.yml"
[ -f docker-compose.dev.override.yml ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.dev.override.yml"
BUILD_DATE=$BUILD_DATE GIT_COMMIT=$GIT_COMMIT VERSION=$VERSION \
  docker compose $COMPOSE_FILES --env-file .env.dev up -d --build
