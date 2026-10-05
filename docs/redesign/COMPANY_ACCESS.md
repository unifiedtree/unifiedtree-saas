# Company access — a role per company (design note)

Status: built on `feat/company-access` (6 Oct 2026). Spec: master context §3.1, §8, §9; audit A-09, A-10, A-13.
Product model (Option A, owner-confirmed 6 Oct): one person = one login = one employee record in their
**main (home) company**. Access to any other company is a **grant** with a role for that company
("Company 1: Manager, Company 3: Employee"). One business per person. Billing counts a person in every
company they can access (billing reads the grants; see the last section).

## Data model

| What | Where | Notes |
|---|---|---|
| Home company | `auth.user_credentials.employee_id → hrms.employees.company_id` | Not stored again. |
| Roles in the home company | `rbac.user_roles` (unchanged) | The person's existing roles. |
| Grants for other companies | `rbac.user_company_access (tenant_id, user_id, company_id, role_id, granted_by, granted_at)`, PK all four ids | New (V143_93). JDBC only. RLS by tenant. |

No row is written for the home company: the home company's roles are `rbac.user_roles`, so the two can
never disagree (every existing role screen keeps writing `user_roles`). This is how "nothing changes for
existing users" is met without a copy that could drift — the migration creates the table and backfills
nothing.

**Workspace-wide roles** — a person who holds any of these built-in roles in `rbac.user_roles` sees
**every** company with the same permissions everywhere (exactly today): `OWNER`, `SUPER_ADMIN`, `ADMIN`,
`COMPANY_ADMIN`, `HR_MANAGER`, `FINANCE_LEAD`. A login with **no employee record** also keeps today's
all-companies behaviour (it has no home company to scope to).

Everyone else (Employee, Dept Manager, Manager, custom roles) is **company-scoped**: they can access their
home company plus the companies they have a grant for. In a granted company their permissions are:
`(permissions of the roles granted there) ∪ employee self-service baseline − their DENY overrides`.
Their personal GRANT overrides apply in the home company only.

Grants may use any role a person could be given today except `OWNER`, `SUPER_ADMIN`, `ADMIN` (those cover
the whole business — give them as roles). The same "levels" rules apply as for roles (only give what you
hold, critical roles only by the owner, never your own access). A grant for the person's home company is
refused (change their roles instead).

## Current company per request

Clients send **`X-Company-Id: <companyId>`** on every API call once the person picks a company (web
selector, app picker). Server side (`CompanyAccessFilter`, after authentication):

1. The companies a request is about: the `X-Company-Id` header, every `companyId` query parameter, and a
   `/companies/{id}` or `/company/{id}` path segment.
2. Each must be accessible to the caller, else **403 `COMPANY_ACCESS_DENIED`** (unknown or other-workspace
   ids too). A malformed header is **400 `INVALID_COMPANY_ID`**. Workspace-wide callers: the header must
   name a company of the workspace; query/path ids are not checked (today's behaviour).
3. Permissions are evaluated in the request's company = path id, else `companyId` param, else header,
   else home. For the home company (and for workspace-wide callers) nothing changes: the token's roles and
   permissions apply. For a granted company the request runs with that company's roles and permissions —
   `hasAuthority`/`hasRole`, `@perm.check`, the JWT `roles`/`permissions` claims seen by controllers, and
   `GET /v1/canonical-auth/me` all see the company's set.
4. No header (old app versions): behaves exactly as today for the home company. A single-company workspace
   never sees a difference.
5. `GET /v1/me/companies` and `/v1/canonical-auth/*` ignore an inaccessible header (so a client with a
   stale company can recover).
6. Kill switch: `unifiedtree.company-access.enforce=false` (env `UNIFIEDTREE_COMPANY_ACCESS_ENFORCE`)
   turns steps 2–3 off; the endpoints keep working.

`GET /v1/hrms/companies` and `GET /v1/tenant/companies` return only the caller's accessible companies for
company-scoped callers (everyone else: unchanged).

## API

- `GET /v1/me/companies` — the caller's companies, home first, each with the caller's role(s) there.
- `GET /v1/workspace/users/{userId}/company-access` — the same view for one person (`workspace.users.read`).
- `POST /v1/workspace/users/{userId}/company-access` `{companyId, roleCode}` — grant (`workspace.users.manage`).
- `DELETE /v1/workspace/users/{userId}/company-access/{companyId}[?roleCode=X]` — revoke one role, or all
  roles in that company (`workspace.users.manage`).
- `GET /v1/workspace/company-access[?companyId=]` — every grant in the workspace (`workspace.users.read`),
  for the Roles & Access page and billing.

No new permission. Grants and revokes write an audit entry (`PERMISSION_CHANGE`) like role changes.
Response shapes: `/c/REACT/ut-wt/_results/company-access-contract.md` (kept in sync with this note).

## Billing query (teammate's lane)

People with access to a company = its employees plus its grantees (workspace-wide admins are counted
where their employee record is, as today):

```sql
SELECT e.company_id, uc.id AS user_id FROM auth.user_credentials uc JOIN hrms.employees e ON e.id = uc.employee_id
UNION
SELECT a.company_id, a.user_id FROM rbac.user_company_access a;
```

## Not enforced yet

Request bodies that carry a `companyId` (creates/updates) are not checked against access; endpoints whose
`companyId` is optional list every company when it is omitted; team/approval views follow reporting lines,
not the current company; services that read roles straight from `rbac.user_roles` (not from the token)
see the home roles. See the build report for the endpoint list.
