# UnifiedTree CRM Module (scaffold)

This module is a **compile-safe placeholder** so the CRM teammate has a
non-empty starting point. There is no CRM business logic here yet. Read
TEAM_MODULE_SPLIT.md (repo root) before you start.

---

## What is committed

- `pom.xml` -- Maven module, parent `com.unifiedtree:unifiedtree-backend`,
  with the dependencies most CRM features need (Spring Data JPA, validation,
  MapStruct, Lombok, shared-security for canonical `TenantContext`).
- `src/main/java/com/unifiedtree/modules/crm/CrmModuleConfiguration.java` --
  empty `@Configuration` so Maven has something to compile. Delete or
  replace as you add real classes.

No tables, no entities, no controllers, no migrations. The canonical
schema is in `backend/app/hrms-app/src/main/resources/db/canonical/`.
Adding a new module migration is described in TEAM_HANDOFF.md sec.4
(the "CRM playbook").

---

## Module contract (what you build next)

### Schema

Create a new `crm` schema in a single migration file
`backend/app/hrms-app/src/main/resources/db/canonical/V0??__crm_leads.sql`
(next sequential V number after the last shipped). Suggested first tables:

| Table | Purpose | Key columns |
|---|---|---|
| `crm.leads` | Inbound prospect captured before qualification | id, tenant_id, name, company, email, phone, source, status, owner_user_id, created_at, ... |
| `crm.accounts` | Qualified company (a.k.a. customer or prospect-org) | id, tenant_id, name, industry, website, owner_user_id, ... |
| `crm.contacts` | People attached to an account | id, tenant_id, account_id, first_name, last_name, email, phone, ... |
| `crm.deals` | Opportunity / pipeline entry | id, tenant_id, account_id, name, value, currency, stage, expected_close_date, owner_user_id, ... |
| `crm.activities` | Calls / emails / meetings / notes timeline | id, tenant_id, lead_or_deal_id, type, summary, due_date, completed_at, owner_user_id, ... |
| `crm.pipelines` | Stage definitions per tenant | id, tenant_id, name, stages JSONB, is_default, ... |

Every one of these is **tenant-scoped**: add `tenant_id UUID NOT NULL`,
create a `tenant_id`-leading index, enable + FORCE RLS, attach a policy
`USING (tenant_id = current_tenant_id())`. Use existing `V005__org.sql`
as the shape template.

### Permissions

In the same migration that creates each table, seed permission codes:

```sql
INSERT INTO rbac.permissions (code, resource, action, description) VALUES
    ('crm.lead.read',      'crm.lead',      'read',  'List and read CRM leads'),
    ('crm.lead.write',     'crm.lead',      'write', 'Create, update, archive CRM leads'),
    ('crm.account.read',   'crm.account',   'read',  'List and read CRM accounts'),
    ('crm.account.write',  'crm.account',   'write', 'Create, update, archive CRM accounts'),
    ('crm.contact.read',   'crm.contact',   'read',  'List and read CRM contacts'),
    ('crm.contact.write',  'crm.contact',   'write', 'Create, update, archive CRM contacts'),
    ('crm.deal.read',      'crm.deal',      'read',  'List and read CRM deals'),
    ('crm.deal.write',     'crm.deal',      'write', 'Create, update, archive CRM deals'),
    ('crm.activity.read',  'crm.activity',  'read',  'List and read CRM activities'),
    ('crm.activity.write', 'crm.activity', 'write',  'Create, update, archive CRM activities')
ON CONFLICT (code) DO NOTHING;
```

Grant them to the `SUPER_ADMIN` system role in the same migration so the
bootstrap admin can use them out of the box (see V017 for the pattern).

### Java code

- Entities live in `com.unifiedtree.modules.crm.<entity>.entity`.
- Repositories in `.repository`.
- Services in `.service`.
- DTOs in `.dto`.
- REST controllers go in `app/hrms-api`, in package
  `com.hrms.api.crm`. Path prefix `/v1/crm`. Add the package to
  `CanonicalProfileScan` if not already covered (it is, via
  `com.hrms.api.*` -- but only `workforce`, `settings`, `auth.canonical`,
  `rbac` are explicitly listed today, so the CRM teammate must add their
  package to the scan list in a small follow-up).

  *Backend lead handles the CanonicalProfileScan edit -- coordinate via
  PR review.*

### REST surface

Path prefix `/v1/crm`. Suggested first endpoints:

```
GET    /v1/crm/leads
POST   /v1/crm/leads
GET    /v1/crm/leads/{id}
PATCH  /v1/crm/leads/{id}
DELETE /v1/crm/leads/{id}            (soft delete via status -> ARCHIVED)
GET    /v1/crm/leads/{id}/activities
POST   /v1/crm/leads/{id}/convert    (lead -> account + deal)

GET    /v1/crm/accounts ...
GET    /v1/crm/contacts ...
GET    /v1/crm/deals    ...
PATCH  /v1/crm/deals/{id}/stage      (move through pipeline)
GET    /v1/crm/pipelines/default
```

Every write endpoint gates with
`@PreAuthorize("hasAuthority('crm.<entity>.write')")`.
Every read gates with `hasAuthority('crm.<entity>.read')`.

### Frontend pairing

Pages live in `apps/platform/src/modules/crm/`:

- `Leads.tsx` -- existing mock page, replace with real list backed by
  `GET /v1/crm/leads`.
- `Customers.tsx` -- maps to `crm.accounts`.
- `Deals.tsx` -- pipeline board view.
- New pages as needed: `LeadDetail`, `AccountDetail`, `DealDetail`.

All routes are already gated by `<ModuleGate moduleKey="crm">` in
`apps/platform/src/App.tsx`. When a tenant has `crm` in
`platform.tenant_modules` with `status='ACTIVE'`, the routes unlock.

---

## Process

1. First PR: pure scaffold (already shipped -- this directory).
2. Second PR: `crm.leads` migration + Lead entity + LeadRepository +
   LeadService + LeadController + Lead list page wired in `apps/platform`.
   Single feature, end-to-end, tenant-isolated.
3. Subsequent PRs: one entity per PR. Resist the urge to ship five
   tables in one shot -- migrations are append-only and review is
   easier in small slices.

PR review required from the backend lead on:

- Any migration in `db/canonical/`.
- Any change to `CanonicalProfileScan`.
- Any change outside `backend/modules/mod-crm/**` or
  `backend/app/hrms-api/src/main/java/com/hrms/api/crm/**` or
  `apps/platform/src/modules/crm/**`.

---

## What NOT to do

- Do not edit shipped V0xx migrations. Add new ones.
- Do not write CRM-specific SQL anywhere outside `db/canonical/`.
- Do not add a separate `crm` Postgres database. Use the existing one,
  separated by schema.
- Do not bypass RLS to "make local dev easier." Set the dev
  `TenantContext` for your test fixtures instead.
- Do not import `com.hrms.api.saas.*` (legacy, will be deleted).
- Do not implement payment, billing, or WhatsApp inside this module.
