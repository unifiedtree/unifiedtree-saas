-- V143.86: HR can answer employees' payslip questions ("Ask payroll") without
-- being able to process payroll (payroll.queries.answer).
--
-- Why. The owner decided on 2026-10-05 that HR must answer the questions
-- employees send from their payslip. Until now the queue
-- (GET /v1/payroll/queries) and the answer (POST /v1/payroll/queries/{id}/answer)
-- needed payroll.runs.manage, which only OWNER, SUPER_ADMIN, ADMIN and
-- FINANCE_LEAD hold, so HR was not told about questions and saw a greyed-out
-- Answer button. payroll.runs.manage also creates and processes payroll runs,
-- so HR must not get it. This adds a narrow permission that opens only the
-- question queue: reading it, answering, and being told when a question is
-- raised. The API accepts either code on those two endpoints; nothing else in
-- payroll looks at the new one.
--
-- Grants (built-in roles only, tenant_id IS NULL): OWNER, SUPER_ADMIN, ADMIN,
-- HR_MANAGER and FINANCE_LEAD. OWNER must hold every permission
-- (OwnerPermissionInvariantCheck), so it is granted here. Roles a business made
-- itself get nothing automatically; V143.69 dates the permission (added_at
-- defaults to now()), so their admins are shown it as a new permission to
-- review. Risk MEDIUM: other people's pay questions, answered in writing; it
-- changes no money.
--
-- Safety. Purely additive: one permission row, one description and level, five
-- grants. Nothing is removed. Until this is applied the API and web behave as
-- before (no one holds the code, so only payroll.runs.manage opens the queue).
-- People pick the change up within a minute on the API (the queue's checks read
-- the database) and at their next sign-in or token refresh on the web.
--
-- Numbered 143.86 (reserved slot in 143.70-143.88). Idempotent: ON CONFLICT DO
-- NOTHING, and the level is set only while it is still the default LOW.
-- Production has Flyway OFF: apply by hand, as the table owner.

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('payroll.queries.answer', 'Answer payslip questions', 'payroll',
     'See the questions employees send about their payslips and answer them. The employee is told. This does not let the person create, process or lock payroll runs.')
ON CONFLICT (code) DO NOTHING;

-- Risk level shown on Roles & permissions (V143.17 columns; guarded like V143.57).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions
       SET risk_level = 'MEDIUM'
     WHERE code = 'payroll.queries.answer'
       AND risk_level = 'LOW';
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'payroll.queries.answer'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;
