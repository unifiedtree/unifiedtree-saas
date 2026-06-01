# UnifiedTree Backend - Architecture (v2)

A **modular monolith** built on Spring Boot 3.2 / Java 21 / PostgreSQL 16.
Designed for ~100K tenants and ~1M monthly active users on a single deployable
artifact, with a clear path to vertical scaling and (later) horizontal sharding.

---

## 1. Module layout (Maven)

```
backend/
+- app/
|  +- hrms-api/                 REST controllers - single HTTP surface
|  +- hrms-app/                 Spring Boot runner, Flyway, actuator, JIB
|
+- platform/                    cross-cutting SaaS platform services
|  +- hrms-auth/                JWT issuance, OTP, password login
|  +- hrms-tenant/              tenant lifecycle, domain routing, module activation
|  +- platform-rbac/            (skeleton) roles & permissions catalog
|  +- platform-audit/           (skeleton) append-only audit writer
|  +- platform-settings/        HR config + holiday calendar
|  +- hrms-notification/        email/SMS/WhatsApp dispatcher
|
+- modules/                     business modules
|  +- hrms-employee/            companies, branches, departments, designations,
|  |                            workforce directory, contractors, classification
|  +- hrms-attendance/          punch records, geofence, face check-in
|  +- hrms-leave/               leave types, balances, requests
|
+- shared/                      libraries every module uses
   +- hrms-core/                BaseEntity, exceptions, tenant context (legacy)
   +- shared-security/          NEW - TenantContext + RLS interceptor
   +- shared-events/            Kafka envelope + serializers
```

**No empty placeholder modules.** When CRM, payroll, accounts etc. start,
add `modules/mod-crm/`, `modules/mod-payroll/` then - not before.

---

## 2. Database schemas

```
Database: unifiedtree

+--------------+--------------------------------------------------+--------+
| Schema       | Owns                                             | RLS    |
+--------------+--------------------------------------------------+--------+
| platform     | tenants, domains, module_catalog, tenant_modules | OFF    |
| auth         | user_credentials, otp_codes, refresh_tokens      | ON     |
| rbac         | roles, permissions, user_roles                   | ON*    |
| org          | companies, branches, geofence_zones              | ON     |
| hrms         | departments, designations, employees, contractors| ON     |
| attendance   | records (partitioned), event_logs (partitioned)  | ON     |
| leave_mgmt   | leave_types, balances, requests, comp_off        | ON     |
| settings     | hr_configuration, holiday_calendar, integrations | ON     |
| audit        | events (partitioned)                             | OFF    |
+--------------+--------------------------------------------------+--------+

*rbac.roles: tenant_id NULL = system role (Super Admin, HR Manager, ...);
 tenant_id NOT NULL = tenant-custom role. Policy:
 USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
```

Migrations live in `app/hrms-app/src/main/resources/db/canonical/V001..V010`.
Activate by setting `SPRING_PROFILES_ACTIVE=canonical`.

The legacy migrations in `db/migration/` are kept untouched as the v1
reference and are still loaded under the default profile so the currently
running backend doesn't break.

---

## 3. Tenant isolation - Row-Level Security

Every tenant-owned table:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
    USING (tenant_id = current_tenant_id());
```

`current_tenant_id()` reads the Postgres GUC `app.tenant_id` set on the
current **transaction**:

```sql
SET LOCAL app.tenant_id = '<uuid>';
```

`LOCAL` is non-negotiable. Without it, PgBouncer in transaction-pooling mode
would leak the tenant id across requests sharing the same physical
connection. The wrapper in `shared-security` enforces this:

`shared-security/TenantAwareDataSource.java` wraps the Hikari pool. On every
`getConnection()`:

1. read `TenantContext.getTenantId()` (ThreadLocal populated by
   `TenantContextFilter` from JWT claim `tenant_id`)
2. if non-null, issue `SET LOCAL app.tenant_id = '<uuid>'`
3. if null, leave it unset - RLS returns zero rows (fail-closed)

**Why fail-closed matters.** A missing tenant id is treated as "no rows
visible," never "all rows." That guarantees:

- A bug that forgets to set the tenant ID returns an empty list, not a
  data leak across tenants.
- Boot-time Flyway runs see nothing (RLS hides everything until the
  policy is bypassed via `BYPASSRLS` role for the migration user).

---

## 4. Partitioning strategy

Three high-volume tables are declarative-partitioned by month:

| Table                       | Key             | Why                                    |
| --------------------------- | --------------- | -------------------------------------- |
| `attendance.records`        | attendance_date | ~2 punches/user/day ? 1 M users -> 730 M/yr |
| `attendance.event_logs`     | event_at        | every check-in/out/break/correction    |
| `audit.events`              | occurred_at     | every write across the platform        |

Postgres single-table performance starts degrading past ~500 M rows. Monthly
partitions keep each partition <100 M rows. Old partitions get archived to
cold storage and dropped - compliance retention is 12 months.

The helper function `attendance.ensure_monthly_partition(year, month)` is
called from a daily cron to maintain a rolling 3-month-ahead window.

---

## 5. HRMS module surface (what the API exposes)

All endpoints under `/v1/`. Tenant isolation comes from the JWT - no
`tenantId` path parameters anywhere.

```
# Workforce
GET    /v1/hrms/companies
POST   /v1/hrms/companies
GET    /v1/hrms/companies/{id}
DELETE /v1/hrms/companies/{id}

GET    /v1/hrms/branches?companyId=...
POST   /v1/hrms/branches
PUT    /v1/hrms/branches/{id}/geofence
DELETE /v1/hrms/branches/{id}

GET    /v1/hrms/departments?companyId=...
POST   /v1/hrms/departments
PATCH  /v1/hrms/departments/{id}/name
DELETE /v1/hrms/departments/{id}

GET    /v1/hrms/designations?companyId=...&departmentId=...
POST   /v1/hrms/designations
DELETE /v1/hrms/designations/{id}

GET    /v1/hrms/employees?companyId&departmentId&branchId&status&search&page&pageSize
GET    /v1/hrms/employees/{id}
POST   /v1/hrms/employees
PUT    /v1/hrms/employees/{id}
POST   /v1/hrms/employees/{id}/confirm?confirmationDate=...
POST   /v1/hrms/employees/{id}/notice?noticeStart=...&lastWorkingDay=...
POST   /v1/hrms/employees/{id}/exit?lastWorkingDay=...&reason=...

GET    /v1/hrms/contractors?companyId=...
POST   /v1/hrms/contractors
DELETE /v1/hrms/contractors/{id}

GET    /v1/hrms/classifications?companyId=...
POST   /v1/hrms/classifications
DELETE /v1/hrms/classifications/{id}

# Settings
GET    /v1/settings/hr-configuration?companyId=...
PUT    /v1/settings/hr-configuration?companyId=...

GET    /v1/settings/holidays?companyId=...&year=...&from=...&to=...
POST   /v1/settings/holidays
DELETE /v1/settings/holidays/{id}
```

Method-level `@PreAuthorize` enforces the role catalog seeded in
`V004__rbac.sql` (`SUPER_ADMIN`, `COMPANY_ADMIN`, `HR_MANAGER`,
`FINANCE_LEAD`, `DEPT_MANAGER`, `EMPLOYEE`).

---

## 6. Build + run

```bash
# Build (all 14 modules, ~70s on a laptop)
cd backend
mvn install -DskipTests

# Run with the canonical schema (fresh DB)
SPRING_PROFILES_ACTIVE=canonical \
DB_URL=jdbc:postgresql://localhost:5432/unifiedtree \
DB_USERNAME=unifiedtree \
DB_PASSWORD=unifiedtree \
java -jar app/hrms-app/target/hrms-app-1.0.0-SNAPSHOT.jar

# Run on the legacy schema (v1 - what's already deployed)
java -jar app/hrms-app/target/hrms-app-1.0.0-SNAPSHOT.jar
```

---

## 7. Operational planning - what to wire BEFORE launch

These weren't built in this pass but the architecture assumes them:

1. **PgBouncer in transaction-pooling mode** between Spring and Postgres.
   Required for RLS `SET LOCAL` to be safe. Recommended pool sizes: app
   side 20-50 connections, PgBouncer pool 200-500.
2. **Postgres read replica.** Route `@Transactional(readOnly=true)` to the
   replica via Spring's `AbstractRoutingDataSource`.
3. **Connection-leak detection.** Hikari `leakDetectionThreshold: 60000`.
4. **Per-tenant rate limiting** at the API gateway (Bucket4j is already a
   dependency). Whale-tenant protection.
5. **Audit writer that doesn't block writes.** Audit emitter publishes to
   Kafka topic `audit.v1`; a separate consumer drains into
   `audit.events`. Currently a placeholder.
6. **Partition rotation cron.** Daily job calls
   `attendance.ensure_monthly_partition(...)` for the next 3 months and
   archives partitions older than 12 months.
7. **Secrets via environment.** Never `application.yml`. Razorpay keys,
   DB passwords, JWT signing keys - all from `${...}` placeholders.

---

## 8. What this session did NOT touch

- **Frontend.** The HR Dashboard React UI matching the client's template is
  a separate session.
- **Java package rename.** Existing code stays in `com.hrms.*`. New code is
  in `com.unifiedtree.*`. A future pass can unify, but it's a high-churn
  rename that touches every import.
- **Data migration from `public.*` to `hrms.*` / `org.*`.** When you cut
  over to the canonical profile, you'll need a migration script to copy
  existing `public.employees` -> `hrms.employees` etc. Not in scope yet.
- **Module business logic beyond HRMS.** Attendance, leave entities/services
  still target the legacy `public.*` tables. They keep working; the
  canonical equivalents can be added module-by-module.

---

## 9. Recommended next-session prompt

```
Build the HR Dashboard frontend in apps/platform to match the client
template at aniledulakanti24.github.io/unified-tree-hr-dashboard.
Start with the four highest-value pages:
  1. Workforce Directory (calls GET /v1/hrms/employees)
  2. Organization Setup (departments + designations CRUD)
  3. Companies & Branches with geofence editor on map
  4. Holiday Calendar
Each page in apps/platform/src/modules/hrms/, using react-query for
data fetching, react-hook-form + zod for forms, the existing Cal Sans
+ emerald design tokens, and framer-motion for entry animations.
Show me each page before moving to the next.
```
