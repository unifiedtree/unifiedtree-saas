-- V143.19: wave-1 integration fix-ups.
--
-- 1. Risk levels and warnings for the permissions wave 1 added in migrations
--    other than V143_17 / V143_17_1 (those files set their own). Without this
--    they stay LOW, and the Roles & permissions levels rule would let anyone
--    who holds them hand them out without the high-risk confirmation.
--    A description is written only when the permission has none.
-- 2. The built-in ADMIN role holds everything OWNER holds except buying
--    modules, the danger zone and platform.* (V143.18). V143.18 copies OWNER's
--    grants as they stand when it runs, so it is re-run here for the wave-1
--    permissions (V143_10 .. V143_17) in case V143.18 was applied before them.
--
-- Needs V143_17 (risk_level / warning columns); guarded so it does nothing
-- for step 1 without them. Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions p
       SET risk_level  = v.risk_level,
           warning     = v.warning,
           description = CASE WHEN p.description IS NULL OR btrim(p.description) = '' THEN v.description ELSE p.description END
      FROM (VALUES
        ('attendance.policy.manage', 'HIGH',
         'Change the company''s attendance timing rules: start time without a shift, grace, half-day limit, late allowance and what happens after it, minimum hours and early leaving.',
         'Money: these rules decide who is marked late, half day or loss of pay, which changes what people are paid.'),
        ('attendance.status.review', 'MEDIUM',
         'See the attendance review list: late arrivals past the allowance, half days, absences, early leaving, missing check-outs, check-ins outside the zone and face punches that need a look. Managers see only their team.',
         NULL),
        ('attendance.status.override', 'HIGH',
         'Excuse a day or change its attendance status (present, late, half day, absent), and confirm or reject face punches. Managers can change only their team; nobody can change their own day.',
         'Money: a changed status is what payroll counts, so this changes what people are paid.'),
        ('hrms.leave.employee.read', 'MEDIUM',
         'See any employee''s leave balances and leave requests on their record.',
         NULL),
        ('hrms.expense.employee.read', 'MEDIUM',
         'See any employee''s expense claims, line items and receipts on their record.',
         NULL),
        ('hrms.retirement.alerts', 'LOW',
         'Get an in-app and phone alert 90 days and again 30 days before someone reaches the company''s retirement age.',
         NULL),
        ('settings.branding.write', 'MEDIUM',
         'Upload, replace or remove the workspace logo and mark shown to everyone in the workspace, on sign-in pages, emails and PDFs.',
         NULL)
      ) AS v(code, risk_level, description, warning)
     WHERE p.code = v.code;
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT admin_role.id, rp.permission_code
  FROM rbac.role_permissions rp
  JOIN rbac.roles owner_role ON owner_role.id = rp.role_id
                            AND owner_role.code = 'OWNER'
                            AND owner_role.tenant_id IS NULL
 CROSS JOIN (SELECT id FROM rbac.roles WHERE code = 'ADMIN' AND tenant_id IS NULL) admin_role
 WHERE rp.permission_code NOT IN ('workspace.modules.buy', 'tenant.settings.write')
   AND rp.permission_code NOT LIKE 'platform.%'
ON CONFLICT DO NOTHING;
