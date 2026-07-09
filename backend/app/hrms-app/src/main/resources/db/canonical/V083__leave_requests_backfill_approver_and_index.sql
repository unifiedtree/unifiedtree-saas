-- =============================================================================
-- V083 — Leave-approvals visibility fix
--
-- Backfills leave_mgmt.leave_requests.approver_id on stale PENDING rows and
-- adds indexes that support the broadened manager-approvals query introduced
-- in LeaveRequestRepository.findPendingForManager.
--
-- Root cause of the "2nd leave application does not appear in manager
-- approvals" symptom: LeaveController.apply() resolves the approver via a
-- multi-step chain (reporting_manager_id → dept head → HR_MANAGER →
-- SUPER_ADMIN) and freezes the resolved UUID into leave_requests.approver_id.
-- If the applicant's manager assignment changes between two applies, or the
-- fallback picks a different UUID, the mgr's exact-match approval query
-- (WHERE approver_id = :mgr) returns nothing.
--
-- Note on Flyway: SPRING_FLYWAY_ENABLED=false on Railway (ut_app has no
-- access to the flyway_schema_history table). This file exists so the DDL
-- change is version-controlled; the main session applies it manually via
-- psycopg as the postgres superuser. Do NOT re-order or renumber.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part A — Backfill approver_id on stale PENDING rows.
--
-- For every PENDING leave whose current approver_id no longer resolves to an
-- in-tenant employee record (deleted, cross-tenant mismatch, or NULL from
-- pre-fallback-fix rows), recompute the approver using the same chain the
-- application uses at apply time. Rows with a still-valid approver_id are
-- left untouched.
-- ---------------------------------------------------------------------------

WITH bad AS (
    SELECT lr.id, lr.tenant_id, lr.employee_id
      FROM leave_mgmt.leave_requests lr
      LEFT JOIN hrms.employees a
             ON a.id = lr.approver_id AND a.tenant_id = lr.tenant_id
     WHERE lr.status = 'PENDING'
       AND (lr.approver_id IS NULL OR a.id IS NULL OR a.is_active = FALSE)
),
resolved AS (
    SELECT b.id AS request_id,
           COALESCE(
             e.reporting_manager_id,
             d.department_head_employee_id,
             (SELECT uc.employee_id
                FROM rbac.user_roles ur
                JOIN auth.user_credentials uc ON uc.id = ur.user_id
               WHERE ur.tenant_id = b.tenant_id
                 AND ur.role_id   = '00000000-0000-0000-0000-000000000002'  -- HR_MANAGER
                 AND uc.employee_id IS NOT NULL
                 AND uc.is_active = TRUE
               ORDER BY uc.created_at
               LIMIT 1),
             (SELECT uc.employee_id
                FROM rbac.user_roles ur
                JOIN auth.user_credentials uc ON uc.id = ur.user_id
               WHERE ur.tenant_id = b.tenant_id
                 AND ur.role_id   = '00000000-0000-0000-0000-000000000001'  -- SUPER_ADMIN
                 AND uc.employee_id IS NOT NULL
                 AND uc.is_active = TRUE
               ORDER BY uc.created_at
               LIMIT 1)
           ) AS new_approver
      FROM bad b
      JOIN hrms.employees e ON e.id = b.employee_id
      LEFT JOIN hrms.departments d ON d.id = e.department_id
)
UPDATE leave_mgmt.leave_requests lr
   SET approver_id = r.new_approver,
       updated_at  = now()
  FROM resolved r
 WHERE lr.id = r.request_id
   AND r.new_approver IS NOT NULL
   AND (lr.approver_id IS DISTINCT FROM r.new_approver);

-- ---------------------------------------------------------------------------
-- Part B — Supporting indexes for the broadened manager-approvals query.
--
-- findPendingForManager joins hrms.employees on lr.employee_id (already
-- covered by hrms.employees.id PK) and hrms.departments on e.department_id
-- (also PK-covered). We need cheap lookups on the two "OR" join keys:
--   e.reporting_manager_id
--   d.department_head_employee_id
-- and a status index to make the top-level filter selective.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_employees_reporting_manager
    ON hrms.employees (reporting_manager_id)
    WHERE reporting_manager_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_departments_head
    ON hrms.departments (department_head_employee_id)
    WHERE department_head_employee_id IS NOT NULL;

-- The (tenant_id, status) composite from V008 already covers status filters
-- for tenant-scoped queries; add a plain (status) partial index for PENDING
-- to speed the broadened join even when Postgres decides not to use the
-- composite.
CREATE INDEX IF NOT EXISTS idx_leave_requests_status_pending
    ON leave_mgmt.leave_requests (status)
    WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Part C — Verification NOTICE. After the backfill runs, RAISE the residual
-- count so the operator applying the migration can see at a glance whether
-- any PENDING rows are still stuck without a resolvable approver (they will
-- need HR to assign an approver manually).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    residual_null   INT;
    residual_stale  INT;
BEGIN
    SELECT COUNT(*) INTO residual_null
      FROM leave_mgmt.leave_requests
     WHERE status = 'PENDING' AND approver_id IS NULL;

    SELECT COUNT(*) INTO residual_stale
      FROM leave_mgmt.leave_requests lr
      LEFT JOIN hrms.employees a
             ON a.id = lr.approver_id AND a.tenant_id = lr.tenant_id
     WHERE lr.status = 'PENDING'
       AND (a.id IS NULL OR a.is_active = FALSE);

    RAISE NOTICE 'V083 backfill complete. PENDING leave_requests still NULL approver_id: %', residual_null;
    RAISE NOTICE 'V083 backfill complete. PENDING leave_requests with stale/inactive approver: %', residual_stale;
END $$;
