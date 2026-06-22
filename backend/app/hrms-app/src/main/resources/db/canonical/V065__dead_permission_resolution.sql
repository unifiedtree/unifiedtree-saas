-- ============================================================================
-- V065 - Dead permission resolution (Hybrid strategy)
-- ----------------------------------------------------------------------------
-- The RBAC verification audit found permissions that were catalogued and
-- granted to roles but NEVER enforced by any @PreAuthorize expression.
-- Resolution per the agreed Hybrid plan:
--
--  (A) RETIRE the genuinely redundant / superseded permissions.
--  (B) ENFORCE the directory-read permissions at their controller endpoints
--      (done in WorkforceController) and BACKFILL grants here so no existing
--      caller is locked out (the endpoints were previously isAuthenticated()
--      or role-gated; every role that could reach them keeps access).
--  (C) DOCUMENT the workspace portal permissions that remain unenforced
--      because their dedicated read endpoints are not built yet (planned).
--
-- Idempotent throughout (ON CONFLICT DO NOTHING / guarded DELETEs).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) RETIRE redundant permissions
--   leave.request.approve  -> superseded by hrms.leave.approve.l1 / .l2
--                             (no controller ever checked it)
--   hrms.leave.write       -> leave configuration is gated by leave.type.write;
--                             hrms.leave.write was never checked anywhere
-- Remove grants first (FK to permissions via permission_code), then catalogue.
-- ----------------------------------------------------------------------------
DELETE FROM rbac.role_permissions
 WHERE permission_code IN ('leave.request.approve', 'hrms.leave.write');

DELETE FROM rbac.permissions
 WHERE code IN ('leave.request.approve', 'hrms.leave.write');

-- ----------------------------------------------------------------------------
-- (B) BACKFILL grants for now-enforced directory reads.
-- Tenant-facing roles: SUPER_ADMIN(0001), HR_MANAGER(0002), FINANCE_LEAD(0003),
-- EMPLOYEE(0004), DEPT_MANAGER(0005), OWNER(0010), ADMIN(0011), MANAGER(0012).
-- (PLATFORM_SUPER_ADMIN reaches these via the `or hasAuthority('platform.admin')`
--  branch on each guard, so it needs no tenant grant.)
-- ----------------------------------------------------------------------------

-- org.company.read  (GET /v1/hrms/companies, /companies/{id}, /branches)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'org.company.read'
  FROM (VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid),
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid),
    ('00000000-0000-0000-0000-000000000005'::uuid),
    ('00000000-0000-0000-0000-000000000010'::uuid),
    ('00000000-0000-0000-0000-000000000011'::uuid),
    ('00000000-0000-0000-0000-000000000012'::uuid)
  ) AS r(id)
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- hrms.department.read  (GET /v1/hrms/departments)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.department.read'
  FROM (VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid),
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid),
    ('00000000-0000-0000-0000-000000000005'::uuid),
    ('00000000-0000-0000-0000-000000000010'::uuid),
    ('00000000-0000-0000-0000-000000000011'::uuid),
    ('00000000-0000-0000-0000-000000000012'::uuid)
  ) AS r(id)
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- hrms.designation.read  (GET /v1/hrms/designations)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.designation.read'
  FROM (VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid),
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid),
    ('00000000-0000-0000-0000-000000000005'::uuid),
    ('00000000-0000-0000-0000-000000000010'::uuid),
    ('00000000-0000-0000-0000-000000000011'::uuid),
    ('00000000-0000-0000-0000-000000000012'::uuid)
  ) AS r(id)
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- hrms.contractor.read  (GET /v1/hrms/contractors)
-- Endpoint previously allowed HR_MANAGER, DEPT_MANAGER, SUPER_ADMIN (+ OWNER via
-- fan-out). Grant ONLY to those roles to preserve the exact prior access set —
-- do NOT broaden contractor visibility to EMPLOYEE / FINANCE_LEAD / ADMIN / MANAGER.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.contractor.read'
  FROM (VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid),   -- SUPER_ADMIN
    ('00000000-0000-0000-0000-000000000002'::uuid),   -- HR_MANAGER
    ('00000000-0000-0000-0000-000000000005'::uuid),   -- DEPT_MANAGER
    ('00000000-0000-0000-0000-000000000010'::uuid)    -- OWNER
  ) AS r(id)
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- (C) PLANNED (not retired, not yet enforced):
--   workspace.account.read   - read own account + workspace list
--   workspace.modules.read   - list active/locked modules
--   workspace.billing.manage - manage billing/subscription
-- These belong to the workspace/account portal whose dedicated read endpoints
-- are not built yet (the portal currently authorises via hasRole('ACCOUNT_USER')
-- and workspace.context.read). They remain granted to OWNER/ADMIN so the
-- capability is ready, and MUST be wired to @PreAuthorize when those endpoints
-- ship. Tracked as a follow-up; intentionally left in the catalogue.
-- ----------------------------------------------------------------------------

DO $$
DECLARE retired INT;
BEGIN
    SELECT count(*) INTO retired FROM rbac.permissions
     WHERE code IN ('leave.request.approve', 'hrms.leave.write');
    RAISE NOTICE 'Retired permissions still present: % (expect 0)', retired;
END $$;
