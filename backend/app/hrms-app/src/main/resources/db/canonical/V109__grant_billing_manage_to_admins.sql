-- ============================================================================
-- V109 - Grant workspace.billing.manage to SUPER_ADMIN, COMPANY_ADMIN, ADMIN
-- ============================================================================
-- Seed gap discovered by the 2026-08-22 client-punchlist audit (Bug B1):
--
--   V017 seeded the full permission catalog onto SUPER_ADMIN via
--       INSERT INTO rbac.role_permissions (role_id, permission_code)
--       SELECT '00000000-0000-0000-0000-000000000001', code FROM rbac.permissions;
--   BEFORE V035 added the workspace.* permissions (workspace.account.read,
--   workspace.context.read, workspace.users.manage, workspace.modules.read,
--   workspace.modules.buy, workspace.billing.manage). The V017 fan-out
--   therefore missed workspace.billing.manage, and V035 explicitly listed
--   it only for OWNER (role_id ...0010).
--
--   Consequence in prod: a SUPER_ADMIN / COMPANY_ADMIN / ADMIN user with no
--   OWNER role could not see the Seats-Usage tile on the workspace shell
--   (SubscriptionAccessGuard checks 'workspace.billing.manage'), even
--   though every other admin surface of the workspace was open to them.
--
-- This migration closes the gap by granting workspace.billing.manage to the
-- three admin role codes. It joins via rbac.roles.code (not by hard-coded
-- UUID) and deliberately does NOT filter on tenant_id: COMPANY_ADMIN was
-- never seeded as a system role row (tenant_id IS NULL), it only exists as
-- tenant-scoped rows created per workspace — so a tenant_id IS NULL filter
-- would skip every COMPANY_ADMIN in the database. Matching on code alone
-- covers both the system roles (SUPER_ADMIN, ADMIN) and any tenant-created
-- COMPANY_ADMIN/ADMIN rows.
--
-- Additive-only: no existing grant is removed. OWNER already holds this
-- permission from V035 and is untouched. SUPER_ADMIN retains everything
-- V017 gave it.
--
-- Idempotent: ON CONFLICT DO NOTHING on the (role_id, permission_code)
-- primary key — safe to re-run. The EXISTS guard also makes it a no-op
-- if 'workspace.billing.manage' is somehow not yet in the permission
-- catalog (defence in depth; V035 already ships it in prod).
-- ============================================================================

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'workspace.billing.manage'
  FROM rbac.roles r
 WHERE r.code IN ('SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN')
   AND EXISTS (
       SELECT 1 FROM rbac.permissions p WHERE p.code = 'workspace.billing.manage'
   )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect >= 3 rows after this runs (SUPER_ADMIN + ADMIN system-role grants
-- added here, plus the OWNER grant that V035 already seeded), plus one row
-- per tenant-scoped COMPANY_ADMIN/ADMIN role that exists in the target DB.
DO $$
DECLARE
    grants INT;
BEGIN
    SELECT count(*) INTO grants
      FROM rbac.role_permissions rp
      JOIN rbac.roles r ON r.id = rp.role_id
     WHERE rp.permission_code = 'workspace.billing.manage'
       AND r.code IN ('SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'OWNER');
    RAISE NOTICE 'workspace.billing.manage admin-tier grants after V109: % (expect >= 3: SUPER_ADMIN + ADMIN + OWNER; +1 per tenant-scoped COMPANY_ADMIN/ADMIN)', grants;
END $$;
