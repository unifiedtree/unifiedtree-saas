-- V121 — hot-read indexes that the scalability audit flagged as
-- limiting factors well before the marketing push.
--
-- All CREATE INDEX statements use IF NOT EXISTS so re-running is a no-op.
-- The optional CONCURRENTLY qualifier is omitted here because migrations
-- outside a transaction block conflict with the "run everything in one
-- txn" pattern used elsewhere. At the current row counts (hundreds to a
-- few thousand rows per table) an ACCESS EXCLUSIVE for the duration of a
-- fast index build is not a real outage window; when a table grows past
-- ~1M rows, add a follow-up V122 with the CONCURRENTLY variant instead.
--
-- Each index is here because a specific hot query would otherwise be
-- forced into a seq scan or an index-then-filter. The comment on each
-- CREATE names the caller.

-- 1. payroll.payslip_lines — RLS + run-totals hot path.
--    RLS injects `tenant_id = current_tenant_id()`. Existing index leads
--    with (run_id, employee_id), so RLS becomes a post-filter and every
--    aggregate over a run pays that cost. Totals also group on `category`.
--    Caller: PayrollRunService.listRunEmployees (:184), buildRunTotals
--    (:407), PayrollReportService.salaryRegisterPdf (:91), StatutoryFileService.
CREATE INDEX IF NOT EXISTS idx_payslip_lines_tenant_run_category
    ON payroll.payslip_lines (tenant_id, run_id, category)
    INCLUDE (amount, employee_id);

-- 2. hrms.employees — company-scoped queries. Every payroll run's
--    "eligible employees" query and every ReportService company-summary
--    filters `company_id = ? AND is_active = TRUE` under RLS. Existing
--    indexes lead with tenant_id but none include company_id, so the
--    whole tenant slice is scanned.
--    Caller: PayrollRunService.queryEligible (:1001), ReportService (:40).
CREATE INDEX IF NOT EXISTS idx_employees_tenant_company_active
    ON hrms.employees (tenant_id, company_id, employment_status)
    WHERE is_active = TRUE;

-- 3. attendance.records — department- and company-scoped aggregations.
--    The four existing indexes cover tenant/emp/branch/status; report
--    generators that filter by `company_id = ?` or `department_id = ?`
--    without an employee predicate degrade to per-partition seq scans.
--    Composite indexes on a partitioned parent propagate to every child.
--    Caller: ReportService.attendanceSummaryReport (:98), lateMarksReport (:156).
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_company_date
    ON attendance.records (tenant_id, company_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant_dept_date
    ON attendance.records (tenant_id, department_id, attendance_date);

-- 4. notif.notifications — the bell dropdown.
--    Existing index (user_id, created_at DESC) omits tenant_id, so the
--    RLS predicate is a post-filter and the DESC sort loses the index
--    ordering when combined with a tenant scan. This screen loads on every
--    page for every signed-in user; not paying full attention here scales
--    directly with concurrent web + mobile users.
--    Caller: AppNotificationRepository.findByUserIdOrderByCreatedAtDesc.
CREATE INDEX IF NOT EXISTS idx_notif_tenant_user_created
    ON notif.notifications (tenant_id, user_id, created_at DESC);
-- Retire the low-cardinality bare `tenant_id` index that has no query
-- shape matching it (dropped IF EXISTS so re-runs stay quiet).
DROP INDEX IF EXISTS notif.idx_notif_tenant;

-- 5. leave_mgmt.leave_requests — approver-dashboard pending queue.
--    Existing partial index is `WHERE status='PENDING'` on the bare
--    column, so scanning it means walking every pending leave across
--    every tenant.
--    Caller: LeaveService.getPendingApprovalsForManager, getAllPending.
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_status_pending
    ON leave_mgmt.leave_requests (tenant_id, status)
    WHERE status IN ('PENDING', 'PENDING_L2');

-- 6. auth.user_credentials — case-insensitive login lookup.
--    AuthService.resolveLoginTenant filters `WHERE lower(email) = lower(?)`,
--    which the case-preserving `(tenant_id, email)` unique constraint
--    cannot serve. Combined with the 500-tenant fanout (tracked separately
--    as CRITICAL C1 in the audit) every login does N seq scans of this
--    table; adding this index at least makes each of those N a single
--    index probe.
--    Caller: AuthService.resolveLoginTenant (:117-118).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_creds_tenant_email_lower
    ON auth.user_credentials (tenant_id, lower(email));
