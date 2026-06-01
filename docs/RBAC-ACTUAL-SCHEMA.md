# RBAC Actual Schema

This documents what is **actually in the database** as of V026. It differs from earlier design specs — use this file, not the specs, when writing migrations or application code.

## Tables

### `rbac.roles`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Hardcoded for system roles (see below) |
| `tenant_id` | UUID nullable | NULL = system role, non-NULL = tenant-custom role |
| `code` | VARCHAR(50) | Unique per (tenant_id, code). NULLS NOT DISTINCT on tenant_id |
| `display_name` | VARCHAR(100) | |
| `description` | TEXT | |
| `is_system` | BOOLEAN | TRUE for all 5 seeded system roles |
| `is_default_for_new_users` | BOOLEAN | Only EMPLOYEE is TRUE |
| `created_at` | TIMESTAMPTZ | |

RLS policy: `tenant_id IS NULL OR tenant_id = current_tenant_id()`

### `rbac.permissions`

| Column | Type | Notes |
|---|---|---|
| `code` | VARCHAR(100) PK | Dotted string e.g. `hrms.report.headcount`. **This is the FK target.** |
| `display_name` | VARCHAR(150) | |
| `module` | VARCHAR(50) | e.g. `hrms`, `attendance`, `rbac` |
| `description` | TEXT nullable | |

No RLS — permission catalog is global/public.

### `rbac.role_permissions`

| Column | Type | Notes |
|---|---|---|
| `role_id` | UUID FK → `rbac.roles.id` | |
| `permission_code` | VARCHAR(100) FK → `rbac.permissions.code` | **String FK, not UUID** |
| PK | `(role_id, permission_code)` | |

**No `default_scope` column.** The spec's V075 design included per-row scopes; this was not implemented. Permission checks are binary: you either have the code or you don't. Data scoping (branch-level, department-level) is enforced separately via PostgreSQL RLS on the data tables, not in the RBAC grant.

RLS: visible if the associated role has `tenant_id IS NULL OR tenant_id = current_tenant_id()`.

### `rbac.user_roles`

| Column | Type | Notes |
|---|---|---|
| `tenant_id` | UUID | |
| `user_id` | UUID FK → `auth.user_credentials.id` | |
| `role_id` | UUID FK → `rbac.roles.id` | |
| `granted_at` | TIMESTAMPTZ | |
| `granted_by` | UUID nullable | |
| PK | `(tenant_id, user_id, role_id)` | |

RLS: `tenant_id = current_tenant_id()`

## System roles (seeded in V004, immutable UUIDs)

| UUID suffix | Code | Grants all reports? | Notes |
|---|---|---|---|
| `...0001` | `SUPER_ADMIN` | Yes | True superset of all permissions. Every new permission migration must also grant to SUPER_ADMIN. |
| `...0002` | `HR_MANAGER` | Yes | Primary HR operator role. |
| `...0003` | `FINANCE_LEAD` | Yes | Payroll + expense + reports. |
| `...0004` | `EMPLOYEE` | No | Default for new users. Self-service only. |
| `...0005` | `DEPT_MANAGER` | Partial (3/5) | Headcount, attendance, leave only. Not diversity/attrition (org-wide strategic). |

**Roles that appear in old specs but do NOT exist:**
- `TENANT_OWNER` — absorbed into `SUPER_ADMIN`
- `HR_ADMIN` — absorbed into `HR_MANAGER`
- `TEAM_LEAD` — known gap; no team-scoped role exists. Team leads currently need `DEPT_MANAGER` for leave approval, which over-privileges them.
- `READ_ONLY_AUDITOR` — known gap; no external auditor role. Enterprise customers will ask for this.

## Migration conventions

1. Always insert into `rbac.permissions` with `ON CONFLICT (code) DO NOTHING`
2. Always insert into `rbac.role_permissions` with `ON CONFLICT (role_id, permission_code) DO NOTHING`
3. Every migration that adds permissions **must** also grant them to `SUPER_ADMIN` (`...0001`) to keep it a true superset
4. Use `SELECT role_id, code FROM rbac.permissions WHERE code IN (...)` pattern — never hardcode permission UUIDs (there are none)
5. Reference role IDs by their hardcoded UUID suffix, not by looking them up dynamically

## Known gaps

- **No `default_scope`**: `<Can permission="..." resource={{branchId}}>` resource checks in the frontend are not DB-enforced. They rely on RLS on data tables, not on RBAC grants.
- **No team-scoped role**: TEAM_LEAD capability missing; workaround is DEPT_MANAGER (over-privileged).
- **No external auditor role**: READ_ONLY_AUDITOR not seeded; no safe way to give external parties read-only access without write power.
- **No `hrms.report.export` permission**: Export buttons are disabled in the UI (`TODO[backend]`) because no CSV export endpoints exist on the backend. When export is implemented, add `hrms.report.export` to this catalogue and grant to SUPER_ADMIN + HR_MANAGER + FINANCE_LEAD.
