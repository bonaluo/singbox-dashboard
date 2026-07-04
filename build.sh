#!/bin/bash
set -e
TAG=$(date +%y.%m.%d.%H.%M)
TAG=$TAG docker compose -f docker-compose.dev.yml --env-file .env.dev up -d --build
