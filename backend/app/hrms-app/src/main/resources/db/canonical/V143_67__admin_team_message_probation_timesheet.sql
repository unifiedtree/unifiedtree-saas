-- V143.67: the built-in ADMIN role gets the three Release 2 permissions it was
-- left out of — hrms.team.message, hrms.probation.team.decide and
-- hrms.timesheet.approve.
--
-- ADMIN ('00000000-0000-0000-0000-000000000011', seeded by V035) is "owner
-- minus billing ownership": V143.18 made it everything OWNER holds except
-- buying modules and resetting or deleting the workspace, and V143.33 re-ran
-- that copy so ADMIN picked up wave 2. Release 2 then added these three
-- permissions and granted them only to OWNER and SUPER_ADMIN (and, for two of
-- them, DEPT_MANAGER / MANAGER / HR_MANAGER):
--   * hrms.team.message            — V143.55
--   * hrms.probation.team.decide   — V143.55
--   * hrms.timesheet.approve       — V143.65
-- Neither migration re-ran the V143.18 copy, so an Admin cannot message a
-- team, decide a team probation, or approve a timesheet week, while an Owner
-- can — none of which is a billing power. The client confirmed on 2026-10-02
-- that Admin should hold all three; this file is the fix.
--
-- Scoped to the system role (r.tenant_id IS NULL), like V143.55 and V143.65.
-- Roles a tenant made themselves are deliberately left alone: an admin there
-- chooses their own grants, and widening them would hand out powers nobody
-- asked for.
--
-- Adds no permission to the catalog (all three already exist) and takes
-- nothing away, so OwnerPermissionInvariantCheck — which asks only that OWNER
-- holds every non-platform permission — is unaffected.
--
-- Numbered 143.67: Release 2 applied 143.50, 143.52–143.62, 143.65 and 143.66
-- on 2 Oct 2026 (there is no 143.51, 143.63 or 143.64), so this sorts after
-- every applied version and reuses none. Idempotent.
-- Production has Flyway OFF: apply by hand, as a superuser (row-level security).

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, v.permission_code
  FROM rbac.roles r
 CROSS JOIN (VALUES
        ('hrms.team.message'),
        ('hrms.probation.team.decide'),
        ('hrms.timesheet.approve')
     ) AS v(permission_code)
 WHERE r.tenant_id IS NULL
   AND r.code = 'ADMIN'
ON CONFLICT DO NOTHING;
