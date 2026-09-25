-- V143.33: wave-2 integration fix-ups (the V143.19 pattern, for V143_20 .. V143_28).
--
-- 1. Description, risk level and warning for every permission wave 2 added.
--    Those migrations were written before V143_17 added rbac.permissions
--    .risk_level / .warning, so their rows sit at the column default LOW.
--    HIGH and CRITICAL ones carry a warning. A description is written only
--    when the permission has none. Guarded on the risk_level column.
-- 2. OWNER and SUPER_ADMIN hold every wave-2 permission
--    (OwnerPermissionInvariantCheck refuses to start the app otherwise).
-- 3. The built-in ADMIN role holds everything OWNER holds except buying
--    modules, owner-level plan changes and platform.* (V143.18 / V143.19,
--    re-run here so ADMIN gets the wave-2 permissions). V143.18 keeps ADMIN
--    out of "resetting or deleting the workspace"; since wave 2 that is
--    workspace.lifecycle.manage (and the full data export beside it,
--    workspace.data.export), which the old danger zone gated on
--    tenant.settings.write. Both stay owner / super admin only, as V143_26
--    granted them.
--
-- 4. The LEAVE_ENCASHMENT salary component for existing workspaces (below).
--
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions p
       SET risk_level  = v.risk_level,
           warning     = v.warning,
           description = CASE WHEN p.description IS NULL OR btrim(p.description) = '' THEN v.description ELSE p.description END
      FROM (VALUES
        -- V143_20 hiring / onboarding
        ('hrms.hiring.interview.write', 'MEDIUM',
         'Schedule, reschedule and cancel interviews for candidates, and choose the interviewers. The interviewers are notified of every change.',
         NULL),
        ('hrms.hiring.interview.self', 'LOW',
         'See the interviews you have been asked to take and submit your scorecard for them. It shows nothing else about the hiring pipeline.',
         NULL),
        ('hrms.onboarding.asset.self', 'LOW',
         'See the company equipment (laptop, ID card, phone...) currently handed to you and what you have returned.',
         NULL),
        -- V143_21 learning
        ('hrms.learning.skill.assess.self', 'LOW',
         'Propose a proficiency level (1 to 5) for your own skills, with a note. Nothing changes on your record until your manager or HR approves it.',
         NULL),
        ('hrms.learning.skill.approve', 'MEDIUM',
         'Approve or reject the skill levels employees propose for themselves. Approving updates the employee''s skill matrix. Managers see only their own team.',
         NULL),
        -- V143_22 master data
        ('hrms.grade.band.read', 'HIGH',
         'See the minimum and maximum annual CTC set for each grade, and the band warning on Salary Structure.',
         'Salary information: shows the pay range of every grade in the company.'),
        -- V143_23 leave
        ('hrms.leave.encash.approve', 'HIGH',
         'See everyone''s leave encashment requests, raise one for an employee, and approve or reject them.',
         'Money: approved days come off the leave balance and are paid as an earning in the next payroll run.'),
        ('hrms.leave.yearend.run', 'HIGH',
         'Credit monthly or quarterly leave now, and run the year-end carry forward.',
         'At year end, unused days above each leave type''s carry-forward cap lapse and can''t be given back from the app.'),
        -- V143_24 payroll / advances
        ('payroll.structure.bulk-revise', 'HIGH',
         'Raise the CTC of many employees at once, by a percentage or a fixed yearly amount, from a chosen date.',
         'Money: one action changes pay for everyone selected, and undoing it means editing each person''s structure by hand.'),
        ('hrms.advance.request.others', 'MEDIUM',
         'Raise a salary advance request on behalf of any employee. It still needs the usual approval and payout, and the employee is notified.',
         NULL),
        -- V143_26 workspace settings
        ('workspace.profile.update', 'MEDIUM',
         'Change the workspace name, contact email and phone, registered address, GSTIN and PAN.',
         NULL),
        ('workspace.security.manage', 'HIGH',
         'Decide who must use two-factor sign-in, see who has it on, and turn it off for someone who lost their phone.',
         'Changes how everyone signs in, and can turn off another person''s two-factor sign-in (they are signed out everywhere).'),
        ('workspace.data.export', 'CRITICAL',
         'Download a full copy of the workspace data: a zip of spreadsheets per module, including salaries and personal details.',
         'Takes every record out of the workspace, salaries and personal details included. Only the workspace owner can give this to someone.'),
        ('workspace.lifecycle.manage', 'CRITICAL',
         'Schedule a reset (clear all records) or permanent deletion of the workspace, and cancel such a request. Only a workspace owner can schedule one; there is always a 7-day wait.',
         'Can start the reset or deletion of the whole workspace. Only the workspace owner can give this to someone.'),
        -- V143_27 reports
        ('hrms.report.exports.read_all', 'MEDIUM',
         'See the whole download history in the Reports Center: who downloaded which report, in which format, with which filters and when.',
         NULL),
        ('hrms.report.schedule.manage', 'HIGH',
         'Set up, change, pause and delete weekly or monthly report emails to workspace members who may open that report.',
         'Sends report data (headcount, attendance, attrition...) by email on a schedule, until someone stops it.')
      ) AS v(code, risk_level, description, warning)
     WHERE p.code = v.code;
  END IF;
END $$;

-- 2. OWNER and SUPER_ADMIN hold every wave-2 permission.
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM rbac.roles r
  JOIN rbac.permissions p ON p.code IN (
        'hrms.hiring.interview.write', 'hrms.hiring.interview.self', 'hrms.onboarding.asset.self',
        'hrms.learning.skill.assess.self', 'hrms.learning.skill.approve',
        'hrms.grade.band.read',
        'hrms.leave.encash.approve', 'hrms.leave.yearend.run',
        'payroll.structure.bulk-revise', 'hrms.advance.request.others',
        'workspace.profile.update', 'workspace.security.manage', 'workspace.data.export', 'workspace.lifecycle.manage',
        'hrms.report.exports.read_all', 'hrms.report.schedule.manage')
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

-- 3. ADMIN: everything OWNER holds except buying modules, owner-level plan
--    changes, platform.* and the danger zone (reset / delete, full export).
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT admin_role.id, rp.permission_code
  FROM rbac.role_permissions rp
  JOIN rbac.roles owner_role ON owner_role.id = rp.role_id
                            AND owner_role.code = 'OWNER'
                            AND owner_role.tenant_id IS NULL
 CROSS JOIN (SELECT id FROM rbac.roles WHERE code = 'ADMIN' AND tenant_id IS NULL) admin_role
 WHERE rp.permission_code NOT IN ('workspace.modules.buy', 'tenant.settings.write',
                                  'workspace.lifecycle.manage', 'workspace.data.export')
   AND rp.permission_code NOT LIKE 'platform.%'
ON CONFLICT DO NOTHING;

-- 4. Leave encashment is paid through payroll (w2d hook, wired at integration):
--    the LEAVE_ENCASHMENT earnings component for existing workspaces, as V143_11
--    does for PLI. New workspaces get it from DefaultComponentSeeder, and a run
--    seeds it lazily when it first pays an encashment. Apply as a superuser (the
--    table has row-level security).
INSERT INTO payroll.salary_components
    (tenant_id, code, name, category, is_statutory, is_taxable, computation_type,
     percent_value, display_order, is_system, is_active)
SELECT t.tenant_id, 'LEAVE_ENCASHMENT', 'Leave encashment', 'EARNING', FALSE, TRUE, 'FORMULA',
       NULL, 46, TRUE, TRUE
  FROM (SELECT DISTINCT tenant_id FROM payroll.salary_components) t
ON CONFLICT (tenant_id, code) DO NOTHING;
