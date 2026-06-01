-- ============================================================================
-- V026__report_permissions.sql
-- ----------------------------------------------------------------------------
-- Seeds the 5 per-report permission codes used by ReportController and grants
-- them to the appropriate system roles.
--
-- Backend @PreAuthorize was already checking these codes; this migration makes
-- them exist in the catalogue so @perm.check() doesn't deny everyone.
--
-- Role grant policy:
--   SUPER_ADMIN   (00000000-...-0001) — must remain a true superset of all codes
--   HR_MANAGER    (00000000-...-0002) — primary consumer of workforce reports
--   FINANCE_LEAD  (00000000-...-0003) — needs headcount/leave for payroll planning
--   DEPT_MANAGER  (00000000-...-0005) — dept-level: headcount, attendance, leave
--   EMPLOYEE      (00000000-...-0004) — no access to any report
--
-- Idempotent: ON CONFLICT DO NOTHING on every INSERT.
-- ============================================================================

-- 1. Insert the 5 permission codes into the catalogue
INSERT INTO rbac.permissions (code, display_name, module) VALUES
    ('hrms.report.headcount',  'View headcount report',                  'hrms'),
    ('hrms.report.attrition',  'View attrition report',                  'hrms'),
    ('hrms.report.attendance', 'View attendance and late-marks reports',  'hrms'),
    ('hrms.report.leave',      'View leave balance report',              'hrms'),
    ('hrms.report.diversity',  'View workforce diversity report',        'hrms')
ON CONFLICT (code) DO NOTHING;

-- 2. SUPER_ADMIN — all 5 (must remain superset)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000001', code
  FROM rbac.permissions
 WHERE code IN (
     'hrms.report.headcount',
     'hrms.report.attrition',
     'hrms.report.attendance',
     'hrms.report.leave',
     'hrms.report.diversity'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 3. HR_MANAGER — all 5
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000002', code
  FROM rbac.permissions
 WHERE code IN (
     'hrms.report.headcount',
     'hrms.report.attrition',
     'hrms.report.attendance',
     'hrms.report.leave',
     'hrms.report.diversity'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 4. FINANCE_LEAD — all 5 (payroll planning requires headcount + leave data)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000003', code
  FROM rbac.permissions
 WHERE code IN (
     'hrms.report.headcount',
     'hrms.report.attrition',
     'hrms.report.attendance',
     'hrms.report.leave',
     'hrms.report.diversity'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 5. DEPT_MANAGER — headcount, attendance, leave (dept-relevant; no diversity/attrition
--    which are org-wide strategic views)
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-000000000005', code
  FROM rbac.permissions
 WHERE code IN (
     'hrms.report.headcount',
     'hrms.report.attendance',
     'hrms.report.leave'
 )
ON CONFLICT (role_id, permission_code) DO NOTHING;
