# Railway Production Deployment — UnifiedTree Backend

How to deploy the canonical backend on Railway with proper DB role
separation, JWT secrets, and CORS lockdown. Read alongside
`BOOTSTRAP.md` (first-admin creation) and `ARCHITECTURE.md` (schema map).

---

## 1. Two Postgres roles, not one

Railway provisions a single owner role per database by default. That
role can read/write everything AND owns every table, which means
PostgreSQL bypasses Row-Level Security for it. RLS is then a no-op for
the application -- exactly the failure mode V012 (FORCE ROW LEVEL
SECURITY) was added to defend against.

Production should split the database account in two:

| Role                 | Owns tables | BYPASSRLS | Used by                  |
|----------------------|:-----------:|:---------:|--------------------------|
| `ut_migrator`        |     YES     |    YES    | Flyway at deploy time    |
| `ut_app`             |     NO      |    NO     | The running Spring app   |

`ut_migrator` runs Flyway with full power; `ut_app` is a constrained
identity that lives under RLS just like any tenant user. If a bug
forgets to set `app.tenant_id`, `ut_app` sees zero rows -- fail-closed.

### Exact SQL to run on a fresh Railway Postgres

Connect as the Railway-provided owner role (visible on Railway's
Postgres instance page; usually `postgres`).

```sql
-- 1. Migration role: owns + BYPASSRLS. Use this in CI/CD's Flyway step.
CREATE ROLE ut_migrator
    LOGIN
    PASSWORD '<long random password #1>'
    NOSUPERUSER NOCREATEROLE
    NOINHERIT
    BYPASSRLS;
GRANT ALL ON DATABASE postgres TO ut_migrator;

-- 2. App role: no ownership, no BYPASSRLS. Used by the Spring app.
CREATE ROLE ut_app
    LOGIN
    PASSWORD '<long random password #2>'
    NOSUPERUSER NOCREATEROLE NOCREATEDB
    NOINHERIT
    NOBYPASSRLS;

-- 3. Let app role connect to the database and use the canonical schemas.
GRANT CONNECT ON DATABASE postgres TO ut_app;

-- 4. After Flyway runs (as ut_migrator), grant ut_app data access on
--    every canonical schema. Run this once after migrations land:
DO $$
DECLARE s text;
BEGIN
    FOREACH s IN ARRAY ARRAY['platform','auth','rbac','org','hrms',
                              'attendance','leave_mgmt','settings','audit']
    LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO ut_app', s);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO ut_app', s);
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO ut_app', s);
        -- Anything Flyway creates in this schema from now on -- default privileges.
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE ut_migrator IN SCHEMA %I '
                       'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ut_app', s);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE ut_migrator IN SCHEMA %I '
                       'GRANT USAGE, SELECT ON SEQUENCES TO ut_app', s);
    END LOOP;
END $$;

-- 5. (Optional) Revoke from the Railway-provided owner so it stops
--    being a fallback path. Skip this if you want to retain owner
--    access for emergency operations.
-- REVOKE ALL ON DATABASE postgres FROM postgres;
```

### Deploy-pipeline order

1. **Migration step** (CI or deploy hook):
   ```
   DB_URL=jdbc:postgresql://...
   DB_USERNAME=ut_migrator
   DB_PASSWORD=<#1>
   SPRING_PROFILES_ACTIVE=canonical,canonical-prod
   ```
   Run a one-shot container or the app with `spring.flyway.enabled=true`
   and `spring.jpa.hibernate.ddl-auto=validate`. Flyway applies V001..V0xx.

2. **Default-privilege re-grant** (one-shot, only after a migration adds a new
   schema -- step 4 above re-run with the new schema name in the array).

3. **App step** (the long-running service):
   ```
   DB_URL=jdbc:postgresql://...
   DB_USERNAME=ut_app
   DB_PASSWORD=<#2>
   SPRING_PROFILES_ACTIVE=canonical,canonical-prod
   spring.flyway.enabled=false   # do NOT let the app role attempt migrations
   ```

Splitting the roles makes V012's `FORCE ROW LEVEL SECURITY` belt +
suspenders: even if a future migration forgets to FORCE RLS, the app
role still cannot see other tenants' rows because it is not the owner.

---

## 2. Required environment variables

Set these on the Railway service running the Spring app:

| Variable                                        | Required | Example / Default                              | Notes |
|-------------------------------------------------|:--------:|------------------------------------------------|-------|
| `SPRING_PROFILES_ACTIVE`                        |   yes    | `canonical,canonical-prod`                     | Both profiles, comma-separated |
| `DB_URL`                                        |   yes    | `jdbc:postgresql://host:5432/postgres`         | Railway internal hostname is fine |
| `DB_USERNAME`                                   |   yes    | `ut_app`                                       | The constrained role, NOT the owner |
| `DB_PASSWORD`                                   |   yes    | (long random)                                  | |
| `UNIFIEDTREE_JWT_SECRET`                        |   yes    | 32+ characters                                 | `openssl rand -base64 48` |
| `UNIFIEDTREE_ALLOWED_ORIGINS`                   |   yes    | `https://app.unifiedtree.com`                  | Comma-separated; no `*` |
| `INVITE_URL_BASE`                               |   yes    | `https://unifiedtree.com`                      | Base URL in invite/reset emails. WITHOUT this, links point at `localhost:3001`. Tenant subdomain is prepended automatically |
| `UNIFIEDTREE_JWT_ISSUER`                        |    no    | `unifiedtree`                                  | |
| `UNIFIEDTREE_JWT_ACCESS_TTL_MIN`                |    no    | `15`                                           | |
| `UNIFIEDTREE_JWT_REFRESH_TTL_DAYS`              |    no    | `7`                                            | |
| `UNIFIEDTREE_CORS_ALLOW_CREDENTIALS`            |    no    | `false`                                        | Set `true` only for cookie flows |
| `HRMS_KAFKA_ENABLED`                            |    no    | `false`                                        | Until Kafka is provisioned |
| `UNIFIEDTREE_BOOTSTRAP_*`                       | first deploy only | see BOOTSTRAP.md                       | Remove after first successful boot |

The app refuses to start if `UNIFIEDTREE_JWT_SECRET` is shorter than 32
characters. The CORS filter rejects every cross-origin request if
`UNIFIEDTREE_ALLOWED_ORIGINS` is empty. Both are intentional fail-safes.

---

## 3. First-time deploy sequence (Railway)

1. Provision a fresh Postgres instance. Note the connection string.
2. Connect with `psql` as the Railway-provided owner role. Run the SQL
   block in section 1 above to create `ut_migrator` + `ut_app`.
3. Run Flyway as `ut_migrator` (easiest: deploy the app once with
   `DB_USERNAME=ut_migrator` and `UNIFIEDTREE_BOOTSTRAP_ENABLED=false`,
   wait for `/actuator/health` to be UP, then redeploy).
4. Re-run section 1's grant DO block as the owner role (Flyway has now
   created the canonical schemas; `ut_app` needs USAGE + DML on them).
5. Redeploy with:
   ```
   DB_USERNAME=ut_app
   SPRING_PROFILES_ACTIVE=canonical,canonical-prod
   UNIFIEDTREE_BOOTSTRAP_ENABLED=true
   UNIFIEDTREE_BOOTSTRAP_TENANT_SUBDOMAIN=<your-subdomain>
   UNIFIEDTREE_BOOTSTRAP_ADMIN_EMAIL=<your-admin@email>
   UNIFIEDTREE_BOOTSTRAP_ADMIN_PASSWORD=<a long random password>
   UNIFIEDTREE_JWT_SECRET=<another long random>
   UNIFIEDTREE_ALLOWED_ORIGINS=<your frontend URL(s)>
   ```
6. Wait for the bootstrap log line:
   ```
   Bootstrap complete: tenant=... admin=... userId=...
   REMOVE the UNIFIEDTREE_BOOTSTRAP_* environment variables now.
   ```
7. Remove the four `UNIFIEDTREE_BOOTSTRAP_*` env vars from the Railway
   service config. Redeploy.
8. Log in via `POST /api/v1/canonical-auth/login`.

---

## 4. Connection pooling note

Railway's free-tier Postgres caps total connections aggressively. The
backend's default Hikari pool (`spring.datasource.hikari.maximum-pool-size`)
is `20`. For a single replica that's usually fine. If you scale to
multiple replicas, put **PgBouncer in transaction-pooling mode** in
front of Postgres. The current `TenantAwareDataSource` uses `SET LOCAL`,
which is PgBouncer-safe -- a regular `SET` would not be.

When you add PgBouncer, you can lower per-replica
`spring.datasource.hikari.maximum-pool-size` to `5` or `10` because the
real backend connection pool lives in PgBouncer.

---

## 5. Things that still need a follow-up before production

| Gap | Risk | Where to fix |
|-----|------|--------------|
| `/v1/canonical-auth/refresh` not implemented | Long sessions force re-login when access token expires | `CanonicalAuthController` + `AuthService` |
| Audit writer not wired (`audit.events` is empty) | No record of who changed what | Phase 3 |
| Rate limiting not wired per-tenant | A whale tenant can starve the rest | Bucket4j (already in deps) + Spring filter |
| Read replica not configured | All traffic hits the primary | Spring `AbstractRoutingDataSource` + `@Transactional(readOnly=true)` routing |
| Connection-leak detection off | A leaked tenant-scoped connection could leak state | `spring.datasource.hikari.leak-detection-threshold=60000` |
| Monthly partitions only seeded through 2026-08 | Rolling window stops in late 2026 | Add a daily cron / boot-time hook that calls `attendance.ensure_monthly_partition(...)` |

None of these are blockers for a small-traffic launch but should be
ticked off before scaling past ~100 active tenants.
