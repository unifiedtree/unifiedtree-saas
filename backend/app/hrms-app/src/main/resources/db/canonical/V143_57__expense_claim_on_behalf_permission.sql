-- V143.57 (redesign P-EXP, BW-61): raise an expense claim for someone else.
--
-- HR, finance and admins raise an expense claim in an employee's name
-- (POST /v1/expense/claims/for/{employeeId}). It is the same claim the employee
-- could submit themselves: the same category caps, routed to the employee's
-- usual approver, then paid through a reimbursement batch. The employee is
-- told (expense.raised_for_you). New permission hrms.expense.claim.others,
-- granted to the roles that hold hrms.advance.request.others today:
-- OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD.
--
-- No table or column changes: the rest of P-EXP's backend (summaries, policy
-- check, caps, status filter) reads existing tables only.
--
-- OWNER and SUPER_ADMIN receive the new permission (OwnerPermissionInvariantCheck).
-- Idempotent: safe to run more than once. Production applies it by hand, as a
-- superuser. Until it is applied, the endpoint answers 403 for everyone (no one
-- holds the permission) and nothing else changes.

INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.expense.claim.others', 'Raise expense claims for others', 'expense',
     'Raise an expense claim in another employee''s name. It goes to their usual approver, and they are told.')
ON CONFLICT (code) DO NOTHING;

-- Risk level shown on Roles & permissions (V143.17 columns; guarded like V143.33).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions
       SET risk_level = 'MEDIUM'
     WHERE code = 'hrms.expense.claim.others'
       AND risk_level = 'LOW';
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.expense.claim.others'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;
