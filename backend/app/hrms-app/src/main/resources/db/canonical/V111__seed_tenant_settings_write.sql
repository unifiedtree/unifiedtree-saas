-- ============================================================================
-- V111 - Seed the tenant.settings.write permission that the code already gates on
-- ============================================================================
-- Deploy-readiness QA, 2026-08-30 (P0-8).
--
-- apps/platform/src/App.tsx gates /settings/danger on
--   P.TENANT_SETTINGS_WRITE = 'tenant.settings.write'
-- and PlatformShell.tsx:257 shows the "Danger Zone" nav pill to SUPER_ADMIN
-- and OWNER. But that permission code was NEVER ADDED TO THE CATALOG — a
-- `SELECT code FROM rbac.permissions WHERE code LIKE 'tenant.%'` returns zero
-- rows. So the gate could not pass for ANYONE, including the workspace owner:
-- the nav showed a pill that always silently redirected to /me.
--
-- Verified before writing this: none of the five live role tokens carries the
-- code, none carries a '*' wildcard, and OWNER+SUPER_ADMIN's 144 permissions
-- do not include it.
--
-- Grant is deliberately narrower than the neighbouring workspace.* codes.
-- PlatformShell.tsx:255-256 states the intent plainly: "Danger Zone is
-- destructive tenant surgery - only SUPER_ADMIN and OWNER (workspace owner)
-- are allowed near it, never a HR/FIN admin." workspace.users.manage would
-- have been the closest existing code but it also covers HR_MANAGER, so it
-- would have widened access past that line.
--
-- Idempotent: ON CONFLICT DO NOTHING on both inserts; safe to re-run.
-- Flyway is disabled in prod (see the V075 note), so this file is the paper
-- trail and the statements are applied manually via psycopg.
-- ============================================================================

INSERT INTO rbac.permissions (code, display_name, module, description)
VALUES ('tenant.settings.write',
        'Modify tenant-level settings',
        'workspace',
        'Workspace-owner surgery: data export, workspace reset, organisation deletion. Deliberately narrower than workspace.* — OWNER and SUPER_ADMIN only.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'tenant.settings.write'
  FROM rbac.roles r
 WHERE r.code IN ('OWNER', 'SUPER_ADMIN')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE granted INT;
BEGIN
    SELECT count(*) INTO granted
      FROM rbac.role_permissions rp
      JOIN rbac.roles r ON r.id = rp.role_id
     WHERE rp.permission_code = 'tenant.settings.write';
    RAISE NOTICE 'tenant.settings.write grants after V111: % (expect >= 2 - OWNER + SUPER_ADMIN)', granted;
END $$;
