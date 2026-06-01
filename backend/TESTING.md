# UnifiedTree Backend - Testing Guide

Two-tier testing strategy: fast unit tests for every commit, Docker-backed
integration tests for the canonical runtime gate.

## Tiers at a glance

| Tier | Pattern | Plugin | Triggered by | Needs Docker |
|------|---------|--------|--------------|--------------|
| Unit / slice | `*Test.java`, `*Tests.java` | maven-surefire-plugin | `mvn test`, `mvn install` | No |
| Integration | `*IT.java` | maven-failsafe-plugin | `mvn verify` | Yes |

This split is configured in `app/hrms-app/pom.xml`:

- Surefire is set to **exclude** `**/*IT.java`
- Failsafe is set to **include** `**/*IT.java`

That means a developer with no Docker can still run the full `mvn clean install`
and a clean unit suite; the runtime gate that needs a real Postgres only fires
when they (or CI) explicitly ask for `mvn verify`.

## Commands

```bash
# Normal build - unit tests only, Docker-free
mvn clean install

# Just compile sources (no tests, fast sanity check)
mvn -pl app/hrms-app test-compile

# Full runtime gate - boots Testcontainers Postgres 16, requires Docker
mvn verify

# Run a single integration test
mvn -pl app/hrms-app -Dit.test=CanonicalRuntimeIT verify
```

## Integration test coverage

`app/hrms-app/src/test/java/com/hrms/app/CanonicalRuntimeIT.java` proves all
four canonical-runtime guarantees in a single test class against a fresh
Postgres 16 container:

1. **Flyway** applies V001..V014 cleanly on an empty database.
2. **Hibernate** `ddl-auto=validate` passes against the canonical schema.
3. **RLS isolation** - tenant A sees only A's rows; tenant B sees only B's;
   a session with no `app.tenant_id` set returns zero rows (fail-closed).
4. **HRMS REST flow** round-trips company -> branch -> department ->
   designation -> employee under tenant A, and tenant B sees zero of A's
   employees via `/v1/hrms/employees`.

Each test is ordered (`@TestMethodOrder(Order)`) so a failure in an earlier
phase fails fast and explains why later phases would have failed too.

## Running locally without Docker

This developer machine currently has no Docker. To prove the same guarantees
manually:

1. Drop the canonical schemas + Flyway history (legacy `public.*` is left alone):
   ```sql
   DROP SCHEMA IF EXISTS platform, auth, rbac, org, hrms,
                          attendance, leave_mgmt, settings, audit CASCADE;
   DROP TABLE  IF EXISTS public.flyway_schema_history_canonical;
   DROP FUNCTION IF EXISTS public.current_tenant_id() CASCADE;
   ```

2. Boot canonical:
   ```powershell
   $env:SPRING_PROFILES_ACTIVE = 'canonical'
   $env:DB_URL      = 'jdbc:postgresql://localhost:5432/hrms'
   $env:DB_USERNAME = 'hrms'
   $env:DB_PASSWORD = 'hrms'
   java -jar app/hrms-app/target/hrms-app-1.0.0-SNAPSHOT.jar
   ```

3. Run the RLS proof script:
   ```bash
   psql -U hrms -d hrms -f scripts/rls_isolation_test.sql
   ```

4. Smoke the REST surface with the PowerShell sequence documented in
   `ARCHITECTURE.md` section 6.

## CI / Railway verification flow

Recommended sequence per build pipeline:

1. `mvn clean install` - compiles, runs unit tests, builds the jar.
2. `mvn verify` - boots a Postgres container, runs `CanonicalRuntimeIT`.
   - Requires `docker` on the build agent.
   - GitHub Actions, GitLab CI, and Railway's own build environment all
     provide Docker by default.
3. On `main` push, additionally:
   - Migrate against a **fresh** Railway Postgres instance using the same
     `SPRING_PROFILES_ACTIVE=canonical` and the canonical migration set.
   - Smoke `/api/actuator/health` and a tenant-scoped `/v1/hrms/employees`
     after deploy.

## Why `CanonicalSecurityConfig` is smoke-test only

`CanonicalSecurityConfig` permits every request and resolves tenant identity
from the unsigned `X-Tenant-ID` HTTP header. That is intentional for the
local proof-of-concept stage, but unacceptable for any environment a stranger
can reach.

Hard guards in the class:

- `@Profile("canonical")` - the config bean only loads when this profile is active.
- `@PostConstruct refuseProductionProfile()` - throws `IllegalStateException`
  at boot time if `SPRING_PROFILES_ACTIVE` contains `prod`, `production`,
  `staging`, or `uat`. The application will refuse to start.
- WARN-level log banner at boot announcing "LOCAL SMOKE TEST MODE ONLY".

Replacing this is Phase 1 of the post-runtime plan documented in
`FEATURE_GAP_MATRIX.md`:

- Migrate the legacy `com.hrms.auth` services onto the canonical
  `auth.user_credentials`, `auth.otp_codes`, and `auth.refresh_tokens` tables.
- Issue signed JWTs with `tenant_id` and `roles` claims.
- Replace `TenantContextFilter`'s X-header fallback with JWT-only resolution
  in production profiles.
- Enable `@EnableMethodSecurity` so `@PreAuthorize` on controllers is enforced.

## Layout cheatsheet

```
app/hrms-app/
  pom.xml                                 surefire/failsafe split
  src/main/resources/db/canonical/        V001..V014 migrations
  src/main/resources/application.yml      default profile
  src/main/resources/application-canonical.yml   smoke-test profile
  src/test/java/com/hrms/app/
    CanonicalRuntimeIT.java               integration test (Docker required)
  src/test/resources/
    application-it.yml                    test-time overrides

shared/shared-security/
  src/main/java/com/unifiedtree/security/
    tenant/TenantContext.java             ThreadLocal tenant id
    tenant/TenantAwareDataSource.java     wraps Hikari, SET LOCAL on getConnection
    web/TenantContextFilter.java          servlet filter, JWT or X-Tenant-ID
    config/SharedSecurityAutoConfiguration.java   ties it together

scripts/
  rls_isolation_test.sql                  manual RLS proof script
```
