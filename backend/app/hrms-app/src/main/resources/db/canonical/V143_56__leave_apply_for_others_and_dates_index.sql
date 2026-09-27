-- V143.56 (HRMS redesign, P-LEAVE): leave applied for someone else, and an
-- index for the leave date-range reads.
--
-- 1. Permission hrms.leave.apply.others: apply for leave in another employee's
--    name (POST /v1/leave/apply/for/{employeeId}). The request is the same one
--    the employee could make: the employee's balance, rules and usual approver,
--    and the employee is told. Granted to the roles that hold
--    hrms.advance.request.others today (OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER,
--    FINANCE_LEAD). OWNER and SUPER_ADMIN must hold it, or
--    OwnerPermissionInvariantCheck refuses to start the app. Module "leave", so
--    Roles & permissions lists it in the Leave group.
-- 2. Index leave_mgmt.leave_requests (tenant_id, start_date, end_date) for the
--    leave calendar, "who's off" and the approval stats. Index only: no column
--    changes (leave_requests is JPA-mapped).
--
-- No new tables or columns; nothing reads a column this file adds. Without it
-- the app still starts: the permission check simply says no (the web hides
-- "Apply on behalf") and the reads run without the index.
-- Numbered 143.56 (assigned range). Idempotent: safe to run more than once.
-- Production has Flyway OFF: apply by hand, as a superuser. leave_requests is
-- small, so a plain CREATE INDEX takes a short lock; on a very large table use
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS (outside a transaction) instead.

-- ── 1. permission ────────────────────────────────────────────────────────────
INSERT INTO rbac.permissions (code, display_name, module, description) VALUES
    ('hrms.leave.apply.others', 'Apply for leave for others', 'leave',
     'Apply for leave in another employee''s name. It goes to their usual approver, and they are told.')
ON CONFLICT (code) DO NOTHING;

-- Risk level shown on Roles & permissions (V143.17 columns; guarded like V143.33).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'rbac' AND table_name = 'permissions' AND column_name = 'risk_level') THEN
    UPDATE rbac.permissions
       SET risk_level = 'MEDIUM'
     WHERE code = 'hrms.leave.apply.others'
       AND risk_level = 'LOW';
  END IF;
END $$;

INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, 'hrms.leave.apply.others'
  FROM rbac.roles r
 WHERE r.tenant_id IS NULL
   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_LEAD')
ON CONFLICT DO NOTHING;

-- ── 2. date-range index ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_dates
    ON leave_mgmt.leave_requests (tenant_id, start_date, end_date);
