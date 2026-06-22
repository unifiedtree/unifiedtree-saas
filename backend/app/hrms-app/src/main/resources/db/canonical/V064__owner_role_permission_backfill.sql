-- ============================================================================
-- V064 - OWNER role permission backfill
-- ----------------------------------------------------------------------------
-- Gap (found by RBAC verification audit): OWNER (...0010) was granted "all
-- tenant-facing permissions" via a ONE-TIME fan-out in V035 (module <> 'platform').
-- That fan-out only captured permissions that existed AT V035 time. Every
-- permission added by later migrations was never back-filled to OWNER:
--   - payroll.*          (V048, V049)
--   - hrms.probation.*   (V045)
--   - hrms.ess.read      (V037)
--   - hrms.employee.invite (V040)
--   - hrms.letters.distribute (V059), hrms.letters.delete (V062)
--   - org.geofence write already covered; settings.read (V037)
--
-- Fix: re-apply the exact V035 OWNER rule (all non-platform permissions).
-- This is idempotent and self-healing for any future module too, but new
-- migrations adding permissions should still grant OWNER explicitly to avoid
-- depending on a re-run of this backfill.
--
-- Idempotent: ON CONFLICT DO NOTHING. SUPER_ADMIN unaffected (kept current by
-- each migration's own grants).
-- ============================================================================

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, p.code
  FROM rbac.permissions p
 WHERE p.module <> 'platform'
ON CONFLICT (role_id, permission_code) DO NOTHING;

DO $$
DECLARE c INT;
BEGIN
    SELECT count(*) INTO c
      FROM rbac.role_permissions rp
      JOIN rbac.permissions p ON p.code = rp.permission_code
     WHERE rp.role_id = '00000000-0000-0000-0000-000000000010'
       AND p.module <> 'platform';
    RAISE NOTICE 'OWNER non-platform grants after backfill: % (should equal count of non-platform permissions)', c;
END $$;
