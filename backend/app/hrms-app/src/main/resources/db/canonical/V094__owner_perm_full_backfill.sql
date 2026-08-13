-- ============================================================================
-- V094 — OWNER role permission full backfill (2026-08-13)
-- ----------------------------------------------------------------------------
-- Bug reported live 2026-08-13: "when I create a new employee, no invitation
-- email arrives". Root cause: OWNER role (…0010) was missing `hrms.employee.invite`,
-- so the SPA's "Send invitation email" checkbox was hidden for OWNER users and
-- no invitation was ever fired. Employee got created silently, admin waited
-- for an email that would never come.
--
-- Wider audit: OWNER was missing 20 non-platform permissions total, including
-- every payroll.* perm (workspace owner couldn't manage payroll), letters.
-- distribute, ess.read, probation.*, and settings.read.
--
-- Root cause pattern: V064 originally back-filled "all non-platform perms" to
-- OWNER as a one-shot. Every migration since then that added new permissions
-- (V048/V049 payroll, V059 letters.distribute, V062 letters.delete, V045
-- probation, V037 ess.read + settings.read) granted them explicitly to
-- SUPER_ADMIN/HR_MANAGER but forgot OWNER. Same pattern as V090 caught for
-- Wave 2-6 perms.
--
-- Fix: re-run V064's exact logic. Idempotent (ON CONFLICT DO NOTHING) — safe
-- to re-apply anytime. New migrations that add perms should ALSO grant OWNER
-- explicitly to avoid relying on periodic re-runs of this backfill.
-- ============================================================================

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.module <> 'platform'
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$
DECLARE
    total_non_platform INT;
    owner_now INT;
    still_missing INT;
BEGIN
    SELECT count(*) INTO total_non_platform FROM rbac.permissions WHERE module <> 'platform';
    SELECT count(*) INTO owner_now FROM rbac.role_permissions rp
      JOIN rbac.permissions p ON p.code = rp.permission_code
     WHERE rp.role_id = '00000000-0000-0000-0000-000000000010'
       AND p.module <> 'platform';
    still_missing := total_non_platform - owner_now;
    RAISE NOTICE 'OWNER perms after backfill: %/% non-platform granted; % still missing (should be 0)',
        owner_now, total_non_platform, still_missing;
END $$;
