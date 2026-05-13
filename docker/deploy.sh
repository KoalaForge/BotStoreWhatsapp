#!/usr/bin/env bash
# ============================================================
# Idempotent deploy + cleanup
# Safe for CI/CD: pull → up → prune. Exits non-zero on failure.
#
# Usage:
#   ./deploy.sh                      # deploys bot stack
#   ./deploy.sh redis                # deploys redis stack
#   ./deploy.sh all                  # deploys both
#   IMAGE_TAG=v1.2.3 ./deploy.sh     # pin image version
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="${1:-bot}"
BOT_FILE="docker-compose.yml"
REDIS_FILE="docker-compose.redis.yml"

deploy_stack() {
  local file="$1"
  local name="$2"
  echo "[deploy] === $name ($file) ==="
  docker compose -f "$file" pull
  docker compose -f "$file" up -d --remove-orphans
  docker compose -f "$file" ps
}

case "$TARGET" in
  bot)   deploy_stack "$BOT_FILE"   "bot" ;;
  redis) deploy_stack "$REDIS_FILE" "redis" ;;
  all)
    deploy_stack "$REDIS_FILE" "redis"
    deploy_stack "$BOT_FILE"   "bot"
    ;;
  *) echo "unknown target: $TARGET (use: bot | redis | all)"; exit 2 ;;
esac

echo "[deploy] running cleanup..."
"$SCRIPT_DIR/cleanup.sh"

echo "[deploy] done."
