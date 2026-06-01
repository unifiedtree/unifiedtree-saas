#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${CYAN}[dev]${NC} $1"; }

cleanup() {
  log "Shutting down..."
  kill $(jobs -p) 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

log "Starting infrastructure..."
docker compose -f deployments/docker-compose.yml up -d postgres redis kafka 2>/dev/null || true

log "Starting backend (Spring Boot)..."
(cd backend && mvn spring-boot:run -pl app/erp-app -am -q) &
BACKEND_PID=$!

sleep 5

log "Starting frontend apps..."
pnpm dev:website &
WEBSITE_PID=$!

pnpm dev:platform &
PLATFORM_PID=$!

pnpm dev:admin &
ADMIN_PID=$!

echo -e "\n${GREEN}All services running:${NC}"
echo -e "  Website:   http://localhost:3000"
echo -e "  Platform:  http://localhost:3001"
echo -e "  Admin:     http://localhost:3002"
echo -e "  Backend:   http://localhost:8080"
echo -e "  Kafka UI:  http://localhost:8090"
echo -e "\n${CYAN}Press Ctrl+C to stop all services${NC}\n"

wait
