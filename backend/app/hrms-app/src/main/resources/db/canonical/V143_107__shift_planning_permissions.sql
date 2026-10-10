-- V143.107: two permissions for the shift planner (shift planning, Phase 1).
--
-- Why. The owner decided (10 Oct 2026, D-S1) that HR/Admin plan shift rosters for the
-- company, department heads plan rosters for their own department, and only HR/Admin
-- publish. Planning and publishing are split so a department head can prepare a roster
-- that HR checks and publishes.
--   * attendance.roster.plan    — create and change draft rosters and rotation patterns,
--     generate, edit days, import from Excel. Someone without attendance.workforce.admin
--     plans only the departments they head (checked by the API on every roster call).
--   * attendance.roster.publish — publish a roster and later changes; people on it are told.
--
-- Grants (built-in roles only, tenant_id IS NULL):
--   plan:    OWNER, SUPER_ADMIN, ADMIN, COMPANY_ADMIN, HR_MANAGER, DEPT_MANAGER
--   publish: OWNER, SUPER_ADMIN, ADMIN, COMPANY_ADMIN, HR_MANAGER
-- OWNER must hold every permission (OwnerPermissionInvariantCheck refuses to start the
-- app otherwise) and ADMIN is the owner minus billing, so all three get both. Roles a
-- business made itself get nothing automatically; V143.69 dates the permissions (added_at
-- defaults to now()), so their admins are shown them as new permissions to review.
-- Risk: plan MEDIUM (drafts only, nobody sees them); publish HIGH (people see the schedule
-- and, once a company switches rosters on for attendance in a later phase, it decides
-- their shift and weekly offs).
--
-- Safety. Purely additive: two permission rows, their levels, eleven grants. Nothing is
-- removed. Until V143.106 is applied the planner endpoints answer FEATURE_NOT_READY, so
-- holding these codes changes nothing else. People pick the change up at their next
-- sign-in or token refresh.
--
-- Numbered 143.107 (reserved for shift planning: 143.106-143.129). Idempotent: ON CONFLICT
-- DO NOTHING, and the level and warning are set only while the level is still the default
-- LOW. Production has Flyway OFF: apply by hand, as the table owner.

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('attendance.roster.plan', 'Plan shift rosters', 'attendance',
     'Create and change draft shift rosters and rotation patterns, generate a roster, edit days and import a roster from Excel. Department heads plan only the departments they head. Publishing needs Publish shift rosters.'),
    ('attendance.roster.publish', 'Publish shift rosters', 'attendance',
     'Publish a shift roster so employees see their schedule, and publish later changes. Each person is told when their schedule is published or one of their days changes.')
ON CONFLICT (code) DO NOTHING;

-- Risk level and warning shown on Roles & permissions (V143.17 columns; guarded like V143.86).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions p
       SET risk_level = v.risk_level,
           warning    = v.warning
      FROM (VALUES
        ('attendance.roster.plan', 'MEDIUM', NULL),
        ('attendance.roster.publish', 'HIGH',
         'Once rosters drive attendance for the company, a published roster decides each person''s shift and weekly offs for late marks, absences and overtime.')
      ) AS v(code, risk_level, warning)
     WHERE p.code = v.code
       AND p.risk_level = 'LOW';
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.roster.plan'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'attendance.roster.publish'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER')
ON CONFLICT DO NOTHING;
