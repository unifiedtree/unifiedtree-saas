#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${CYAN}[setup]${NC} $1"; }
ok()  { echo -e "${GREEN}[ok]${NC} $1"; }
warn(){ echo -e "${YELLOW}[warn]${NC} $1"; }
fail(){ echo -e "${RED}[fail]${NC} $1"; exit 1; }

echo -e "\n${CYAN}╔═══════════════════════════════════╗${NC}"
echo -e "${CYAN}║     UnifiedTree — Dev Setup           ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════╝${NC}\n"

# Check prerequisites
command -v node >/dev/null 2>&1 || fail "Node.js not found. Install v20+."
command -v pnpm >/dev/null 2>&1 || fail "pnpm not found. Run: npm i -g pnpm"
command -v java >/dev/null 2>&1 || fail "Java not found. Install JDK 21."
command -v mvn  >/dev/null 2>&1 || fail "Maven not found. Install Maven 3.9+."
command -v docker >/dev/null 2>&1 || warn "Docker not found. Infrastructure won't start."

log "Checking Node version..."
NODE_VER=$(node -v | sed 's/v//')
MAJOR=$(echo $NODE_VER | cut -d. -f1)
[ "$MAJOR" -ge 20 ] || fail "Node 20+ required (got $NODE_VER)"
ok "Node v$NODE_VER"

log "Installing frontend dependencies..."
pnpm install
ok "pnpm install done"

log "Building shared packages..."
pnpm --filter '@erp/ui-kit' build 2>/dev/null || true
pnpm --filter '@erp/shared-types' build 2>/dev/null || true
ok "Packages built"

log "Setting up environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
else
  warn ".env already exists — skipping"
fi

if command -v docker >/dev/null 2>&1; then
  log "Starting infrastructure (Postgres, Redis, Kafka)..."
  docker compose -f deployments/docker-compose.yml up -d postgres redis zookeeper kafka
  ok "Infrastructure started"
  log "Waiting for Postgres..."
  until docker exec unifiedtree-postgres pg_isready -U nexus >/dev/null 2>&1; do
    printf '.'
    sleep 2
  done
  echo ""
  ok "Postgres ready"
fi

log "Installing backend dependencies..."
(cd backend && mvn -B dependency:go-offline -q)
ok "Maven deps cached"

echo -e "\n${GREEN}Setup complete!${NC}"
echo -e "\nStart everything:  ${CYAN}./scripts/dev.sh${NC}"
echo -e "Or individually:"
echo -e "  Backend:   ${CYAN}cd backend && mvn spring-boot:run -pl app/erp-app -am${NC}"
echo -e "  Website:   ${CYAN}pnpm dev:website${NC}"
echo -e "  Platform:  ${CYAN}pnpm dev:platform${NC}"
echo -e "  Admin:     ${CYAN}pnpm dev:admin${NC}\n"
