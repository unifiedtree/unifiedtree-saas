#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

FAILED=0
PASSED=0

run() {
  local name=$1
  shift
  echo -e "\n${CYAN}▶ $name${NC}"
  if "$@"; then
    echo -e "${GREEN}✓ $name passed${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗ $name failed${NC}"
    ((FAILED++))
  fi
}

run "TypeScript type-check" pnpm type-check
run "ESLint"                pnpm lint
run "Frontend build"        pnpm build
run "Backend tests"         bash -c "cd backend && mvn -B test"

echo -e "\n────────────────────────────"
echo -e "Passed: ${GREEN}$PASSED${NC}  Failed: ${RED}$FAILED${NC}"

[ "$FAILED" -eq 0 ] || exit 1
echo -e "${GREEN}All checks passed!${NC}\n"
