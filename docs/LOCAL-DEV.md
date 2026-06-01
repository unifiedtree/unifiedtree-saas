# Local Development Setup

## Prerequisites

- Java 21 (Eclipse Temurin recommended)
- PostgreSQL 16+
- Node 20+ with pnpm
- Maven 3.9+

---

## Database

### Create the database and roles

```sql
-- Run as postgres superuser
CREATE DATABASE hrms OWNER postgres;
CREATE ROLE hrms SUPERUSER LOGIN PASSWORD 'hrms';
CREATE ROLE hrms_app LOGIN PASSWORD 'hrms_app';
GRANT CONNECT ON DATABASE hrms TO hrms_app;
```

The Flyway migrations create all schemas and grant `hrms_app` the minimum required
permissions (USAGE on each schema + table-level grants).

### Seed data

The `canonical` Spring profile loads Flyway locations:
- `db/canonical/` — schema + permissions (V001–V033)
- `db/dev-seed/` — demo tenant, two users, one company, two employees

Demo accounts (password for both: `Hrms@12345`):
- `admin@unifiedtree.demo` — SUPER_ADMIN
- `reader@unifiedtree.demo` — EMPLOYEE

Tenant ID: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`

---

## Running the backend

```bash
cd backend/app/hrms-app

DB_URL="jdbc:postgresql://localhost:5432/hrms" \
DB_USERNAME=hrms \
DB_PASSWORD=hrms \
UNIFIEDTREE_JWT_SECRET="dev-secret-for-local-testing-only-32chars" \
mvn spring-boot:run -Dspring-boot.run.profiles=canonical,canonical-prod
```

Server starts at `http://localhost:8080/api`.

### Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| `DB_URL` | `jdbc:postgresql://localhost:5432/unifiedtree_hrms` | Override for local DB |
| `DB_USERNAME` | `unifiedtree` | Must be a user with CREATE SCHEMA rights for Flyway |
| `DB_PASSWORD` | _(none)_ | |
| `UNIFIEDTREE_JWT_SECRET` | `CHANGE_ME` (fails — too short) | Must be 32+ chars |
| `SMTP_HOST` | `localhost` | |
| `SMTP_PORT` | `1025` | See mail section below |
| `SMTP_AUTH` | `false` | Set `true` for real SMTP with credentials |
| `SMTP_STARTTLS` | `false` | Set `true` for real SMTP |
| `SMTP_USERNAME` | _(empty)_ | |
| `SMTP_PASSWORD` | _(empty)_ | |

---

## Email (HR Letters send)

In development, point the app at **Mailpit** — a local mail catcher that accepts all
messages without authentication and shows them in a browser UI.

### Start Mailpit

Download the Windows binary from the [Mailpit releases page](https://github.com/axllent/mailpit/releases)
and run:

```bash
mailpit.exe --smtp "127.0.0.1:1025" --smtp-auth-accept-any --smtp-auth-allow-insecure
```

Mailpit listens on:
- SMTP: `localhost:1025`
- Web UI: `http://localhost:8025`

The backend defaults to `SMTP_PORT=1025` and `SMTP_AUTH=false`, so no additional
configuration is needed — just start Mailpit before starting the backend.

### Using a real SMTP server

For production or if you want actual delivery in dev:

```bash
SMTP_HOST=smtp.gmail.com \
SMTP_PORT=587 \
SMTP_AUTH=true \
SMTP_STARTTLS=true \
SMTP_USERNAME=your@gmail.com \
SMTP_PASSWORD=app-password-here \
mvn spring-boot:run ...
```

---

## Running the frontend

```bash
# From repo root
pnpm install
pnpm --filter platform dev
```

Frontend starts at `http://localhost:3001`. It proxies `/api` to `localhost:8080`.

The proxy strips the `Origin` header from forwarded requests so Spring's CORS
filter never triggers in local dev. **Do not** set `UNIFIEDTREE_ALLOWED_ORIGINS`
for local dev — it's only needed in production deployments where the frontend is
served from a separate origin (e.g. `https://app.unifiedtree.com`).

### Logging in locally

On plain `localhost` there is no subdomain to identify the workspace, so the login
page shows a **Workspace** field. Enter either:
- The tenant UUID: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`
- Or a subdomain slug if you have one registered in `public.tenants`

---

## Running integration tests

Integration tests use Testcontainers (Docker required).

```bash
cd backend/app/hrms-app

# Run all IT suites (23 tests total)
mvn test -Dtest="AttendanceFlowIT,LeaveFlowIT,AuditControllerIT,LetterFlowIT"
```

Note: Surefire's default pattern excludes `*IT.java` files. Always specify them
with `-Dtest` or configure the Surefire plugin to include `*IT` patterns.

---

## Quick API test (after server is up)

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/canonical-auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "email":"admin@unifiedtree.demo",
    "password":"Hrms@12345"
  }' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# Check employees
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/employees

# Check letter templates
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/letters/templates
```
