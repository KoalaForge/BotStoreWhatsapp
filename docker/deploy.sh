#!/bin/bash
# ============================================================
# KoalaStore WA Bot - Near-Zero Downtime Deploy Script
# ============================================================
# Deploys Docker containers with minimal gap by:
#   1. Pre-pulling new image (while old containers still run)
#   2. Stopping each service gracefully (SIGTERM + drain)
#   3. Starting new container immediately
#   4. Waiting for health check to pass
#   5. Reporting actual downtime per service
#   6. Pruning stale images & build cache (>7 days)
#
# Usage:
#   ./deploy.sh              # Deploy all services in docker-compose.yml
#   ./deploy.sh <service>    # Deploy a specific service
#
# Environment:
#   HEALTH_TIMEOUT   Max seconds to wait for healthy (default: 60)
#   COMPOSE_FILE     Path to docker-compose.yml (default: ./docker-compose.yml)
# ============================================================

set -euo pipefail

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $(date '+%H:%M:%S') $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date '+%H:%M:%S') $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%H:%M:%S') $*"; }
log_step()  { echo -e "${BLUE}[STEP]${NC}  $(date '+%H:%M:%S') $*"; }

now_ms() {
    date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))'
}

wait_for_healthy() {
    local service="$1"
    local timeout="$2"
    local elapsed=0

    while [ "$elapsed" -lt "$timeout" ]; do
        local health
        health=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || echo "unknown")

        case "$health" in
            healthy)
                return 0
                ;;
            unhealthy)
                log_error "$service is unhealthy!"
                docker logs --tail 20 "$service" 2>&1 || true
                return 1
                ;;
            *)
                sleep 2
                elapsed=$((elapsed + 2))
                ;;
        esac
    done

    log_error "$service did not become healthy within ${timeout}s"
    docker logs --tail 20 "$service" 2>&1 || true
    return 1
}

deploy_service() {
    local service="$1"

    log_step "Deploying ${service}..."

    local was_running=false
    if docker ps --format '{{.Names}}' | grep -q "^${service}$"; then
        was_running=true
    fi

    local stop_start
    stop_start=$(now_ms)

    if [ "$was_running" = true ]; then
        log_info "Stopping ${service} (graceful drain)..."
        docker compose -f "$COMPOSE_FILE" stop "$service" 2>&1
    fi

    log_info "Starting ${service} with new image..."
    docker compose -f "$COMPOSE_FILE" up -d --no-deps "$service" 2>&1

    log_info "Waiting for ${service} to become healthy (timeout: ${HEALTH_TIMEOUT}s)..."
    if wait_for_healthy "$service" "$HEALTH_TIMEOUT"; then
        local stop_end
        stop_end=$(now_ms)
        local downtime_ms=$((stop_end - stop_start))
        local downtime_s=$((downtime_ms / 1000))
        local downtime_remainder=$((downtime_ms % 1000))

        log_info "${service} healthy. Downtime: ${downtime_s}.${downtime_remainder}s"
        echo "${service}:${downtime_ms}" >> /tmp/deploy_downtimes_$$ 2>/dev/null || true
    else
        log_error "${service} failed health check — check logs!"
        return 1
    fi
}

main() {
    log_step "=== KoalaStore WA Near-Zero Downtime Deploy ==="

    rm -f /tmp/deploy_downtimes_$$

    log_step "Pre-pulling new images (bots still running)..."
    docker compose -f "$COMPOSE_FILE" pull 2>&1
    log_info "Images pulled."

    if [ $# -gt 0 ]; then
        deploy_service "$1"
    else
        local services
        services=$(docker compose -f "$COMPOSE_FILE" config --services 2>/dev/null)

        if [ -z "$services" ]; then
            log_error "No services found in $COMPOSE_FILE"
            exit 1
        fi

        local failed=0
        for service in $services; do
            if ! deploy_service "$service"; then
                log_error "Failed to deploy ${service}"
                failed=$((failed + 1))
            fi
            echo ""
        done

        if [ "$failed" -gt 0 ]; then
            log_error "${failed} service(s) failed to deploy!"
            exit 1
        fi
    fi

    # Storage cleanup — bound disk usage after deploy
    log_info "Pruning old images (>7 days)..."
    docker image prune -af --filter "until=168h" 2>&1 | tail -1
    log_info "Pruning build cache (>7 days)..."
    docker builder prune -af --filter "until=168h" 2>&1 | tail -1
    log_info "Pruning dangling volumes..."
    docker volume ls -qf dangling=true | xargs -r docker volume rm 2>&1 | tail -1 || true

    echo ""
    log_step "=== Deploy Summary ==="
    docker compose -f "$COMPOSE_FILE" ps
    echo ""

    if [ -f /tmp/deploy_downtimes_$$ ]; then
        log_info "Downtime per service:"
        while IFS=: read -r svc ms; do
            local s=$((ms / 1000))
            local r=$((ms % 1000))
            echo "  ${svc}: ${s}.${r}s"
        done < /tmp/deploy_downtimes_$$
        rm -f /tmp/deploy_downtimes_$$
    fi

    log_info "Deploy complete."
}

main "$@"
