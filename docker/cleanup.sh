#!/usr/bin/env bash
# ============================================================
# Post-deploy storage cleanup
# Run after `docker compose pull && up -d` to reclaim disk.
# ============================================================
set -euo pipefail

echo "[cleanup] dangling images..."
docker image prune -f

echo "[cleanup] stopped containers..."
docker container prune -f

echo "[cleanup] unused build cache..."
docker builder prune -f --filter "until=168h"

echo "[cleanup] unused anonymous volumes (skips named volumes like redis-data)..."
docker volume ls -qf dangling=true | xargs -r docker volume rm

echo "[cleanup] orphan networks..."
docker network prune -f

echo "[cleanup] disk usage after:"
docker system df
