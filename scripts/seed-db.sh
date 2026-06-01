#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${CYAN}[seed]${NC} $1"; }
ok()  { echo -e "${GREEN}[ok]${NC} $1"; }

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-unifiedtree}
DB_USER=${DB_USER:-nexus}
DB_PASS=${DB_PASS:-nexus}

export PGPASSWORD="$DB_PASS"

psql_exec() {
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

log "Seeding demo tenant: Acme Corp..."
psql_exec "
  INSERT INTO tenants (id, name, subdomain, plan_type, status, company_size, industry)
  VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Acme Corp',
    'acme',
    'PROFESSIONAL',
    'ACTIVE',
    'MEDIUM',
    'Technology'
  ) ON CONFLICT (subdomain) DO NOTHING;
"

log "Seeding demo admin user..."
psql_exec "
  INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, status, role)
  VALUES (
    'u0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'admin@acme.unifiedtree.com',
    '\$2a\$12\$placeholder_hash',
    'Admin',
    'User',
    'ACTIVE',
    'SUPER_ADMIN'
  ) ON CONFLICT (email) DO NOTHING;
"

log "Activating modules for demo tenant..."
for module in hrms crm accounts payroll; do
  psql_exec "
    INSERT INTO tenant_modules (tenant_id, module_key, status, activated_at)
    VALUES (
      'a0000000-0000-0000-0000-000000000001',
      '$module',
      'ACTIVE',
      NOW()
    ) ON CONFLICT (tenant_id, module_key) DO NOTHING;
  "
done

ok "Database seeded!"
echo -e "\nDemo credentials:"
echo -e "  URL:      http://acme.localhost:3001"
echo -e "  Email:    admin@acme.unifiedtree.com"
echo -e "  Password: (set via /api/v1/auth/reset-password)\n"
