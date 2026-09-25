package com.hrms.app.reports;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Six canonical HRMS reports — all executed as tenant-scoped read-only queries.
 * RLS on the DB side ensures cross-tenant leakage is impossible even if
 * tenant_id is accidentally omitted from a query.
 */
@Service
public class ReportService {

    private final JdbcTemplate jdbc;

    public ReportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── 1. Headcount Report ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> headcountReport(UUID companyId, LocalDate asOf) {
        // Who is employed on asOf. The workforce exit flow records the leaving
        // date in last_working_day and leaves date_of_termination NULL, so the
        // old filter on date_of_termination alone counted every exited person.
        // An exit only ends employment once the status says so: someone on
        // notice with a future last day is still here; a last working day on or
        // before asOf counts as gone (the status already says they left).
        // department_id lets a click open that department's people. (Gender
        // stays in the diversity report, behind its own permission.)
        //
        // The active / notice / probation split is each person's status ON
        // asOf, read from hrms.employee_status_history (V143_27: fed by a
        // trigger on every status change, backfilled from the record's own
        // dates), not today's status. Someone whose exit is still to come
        // counts as on notice. Without a history row (should not happen after
        // the backfill) the current status is used, as before.
        String sql = """
                WITH status_on AS (
                    SELECT DISTINCT ON (h.employee_id) h.employee_id, h.status
                      FROM hrms.employee_status_history h
                     WHERE h.effective_on <= ?
                     ORDER BY h.employee_id, h.effective_on DESC, h.recorded_at DESC
                )
                SELECT
                    d.id                            AS department_id,
                    d.name                          AS department,
                    COUNT(e.id)                     AS total,
                    SUM(CASE WHEN COALESCE(s.status, e.employment_status) = 'ACTIVE'    THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN COALESCE(s.status, e.employment_status)
                                  IN ('NOTICE_PERIOD', 'EXITED', 'TERMINATED', 'RESIGNED') THEN 1 ELSE 0 END) AS on_notice,
                    SUM(CASE WHEN COALESCE(s.status, e.employment_status) = 'PROBATION' THEN 1 ELSE 0 END) AS probation
                FROM hrms.employees e
                LEFT JOIN status_on s ON s.employee_id = e.id
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND e.date_of_joining <= ?
                  AND NOT (
                        e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                    AND COALESCE(e.last_working_day, e.date_of_termination, DATE '1900-01-01') <= ?
                  )
                GROUP BY d.id, d.name
                ORDER BY total DESC
                """;
        return jdbc.queryForList(sql, asOf, companyId, asOf, asOf);
    }

    // ── 2. Attrition Report ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> attritionReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        // One row per month in [from, to], months without exits included, so a
        // trend line has no gaps. An exit is a person whose status is EXITED,
        // TERMINATED or RESIGNED, dated by last_working_day (the workforce exit
        // flow leaves date_of_termination NULL). People still serving notice
        // are not exits yet, even with a last working day set. The workforce
        // flow marks everyone EXITED, so "resignations" only counts the legacy
        // RESIGNED status and other_exits holds the rest. headcount is who was
        // employed at the month's end (or today, for the current month);
        // attrition_pct is exits over the month's average headcount.
        String sql = """
                WITH people AS (
                    SELECT e.date_of_joining AS joined,
                           e.employment_status AS status,
                           CASE WHEN e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                                THEN COALESCE(e.last_working_day, e.date_of_termination) END AS left_on
                    FROM hrms.employees e
                    WHERE e.company_id = ?
                ), months AS (
                    SELECT m::date AS m_start,
                           LEAST((m + INTERVAL '1 month' - INTERVAL '1 day')::date, CURRENT_DATE) AS m_end
                    FROM generate_series(date_trunc('month', ?::date), date_trunc('month', ?::date), INTERVAL '1 month') AS m
                ), agg AS (
                    SELECT mo.m_start,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end)                                AS exits,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end AND p.status = 'RESIGNED')      AS resignations,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end AND p.status = 'TERMINATED')    AS terminations,
                           COUNT(*) FILTER (WHERE p.left_on BETWEEN mo.m_start AND mo.m_end AND p.status = 'EXITED')        AS other_exits,
                           COUNT(*) FILTER (WHERE p.joined <  mo.m_start AND (p.left_on IS NULL OR p.left_on >= mo.m_start)) AS opening,
                           COUNT(*) FILTER (WHERE p.joined <= mo.m_end   AND (p.left_on IS NULL OR p.left_on >  mo.m_end))   AS closing
                    FROM months mo
                    LEFT JOIN people p ON TRUE
                    GROUP BY mo.m_start
                )
                SELECT TO_CHAR(m_start, 'YYYY-MM') AS month,
                       exits, resignations, terminations, other_exits,
                       closing AS headcount,
                       COALESCE(ROUND(exits * 100.0 / NULLIF((opening + closing) / 2.0, 0), 2), 0) AS attrition_pct
                FROM agg
                ORDER BY m_start
                """;
        return jdbc.queryForList(sql, companyId, fromDate, toDate);
    }

    // ── 3. Attendance Summary Report ─────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> attendanceSummaryReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        String sql = """
                SELECT
                    e.employee_code,
                    -- COALESCE is load-bearing: in Postgres `x || NULL` is NULL,
                    -- so an employee with no last_name produced employee_name = null,
                    -- which crashed HrAvatar (name.split) and blanked the whole SPA.
                    TRIM(e.first_name || ' ' || COALESCE(e.last_name, ''))  AS employee_name,
                    d.name                                               AS department,
                    COUNT(ar.id)                                         AS present_days,
                    COALESCE(SUM(CASE WHEN ar.attendance_status = 'LATE' THEN 1 ELSE 0 END), 0) AS late_days,
                    COALESCE(ROUND(AVG(ar.work_hours)::numeric, 2), 0)   AS avg_hours,
                    COALESCE(SUM(ar.overtime_minutes), 0)                AS total_overtime_mins
                FROM hrms.employees e
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                LEFT JOIN attendance.records ar
                    ON ar.employee_id = e.id
                   AND ar.attendance_date BETWEEN ? AND ?
                WHERE e.company_id = ?
                  AND e.employment_status = 'ACTIVE'
                GROUP BY e.employee_code, e.first_name, e.last_name, d.name
                ORDER BY late_days DESC, e.last_name
                """;
        return jdbc.queryForList(sql, fromDate, toDate, companyId);
    }

    // ── 4. Leave Balance Report ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> leaveBalanceReport(UUID companyId, int year) {
        String sql = """
                SELECT
                    e.employee_code,
                    -- COALESCE is load-bearing: in Postgres `x || NULL` is NULL,
                    -- so an employee with no last_name produced employee_name = null,
                    -- which crashed HrAvatar (name.split) and blanked the whole SPA.
                    TRIM(e.first_name || ' ' || COALESCE(e.last_name, ''))  AS employee_name,
                    d.name                                               AS department,
                    lt.name                                              AS leave_type,
                    lb.total_entitlement,
                    lb.used,
                    lb.pending,
                    lb.carry_forward,
                    (lb.total_entitlement + lb.carry_forward - lb.used - lb.pending) AS available
                FROM leave_mgmt.leave_balances lb
                JOIN hrms.employees e  ON e.id = lb.employee_id
                JOIN leave_mgmt.leave_types lt ON lt.id = lb.leave_type_id
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND lb.year = ?
                  AND e.employment_status = 'ACTIVE'
                ORDER BY e.last_name, lt.name
                """;
        return jdbc.queryForList(sql, companyId, year);
    }

    // ── 5. Late Marks Report ─────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> lateMarksReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        String sql = """
                SELECT
                    e.employee_code,
                    -- COALESCE is load-bearing: in Postgres `x || NULL` is NULL,
                    -- so an employee with no last_name produced employee_name = null,
                    -- which crashed HrAvatar (name.split) and blanked the whole SPA.
                    TRIM(e.first_name || ' ' || COALESCE(e.last_name, ''))  AS employee_name,
                    d.name                                               AS department,
                    ar.attendance_date,
                    ar.late_by_minutes,
                    ar.check_in_at
                FROM attendance.records ar
                JOIN hrms.employees e ON e.id = ar.employee_id
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND ar.attendance_date BETWEEN ? AND ?
                  AND ar.attendance_status = 'LATE'
                ORDER BY ar.late_by_minutes DESC, ar.attendance_date
                """;
        return jdbc.queryForList(sql, companyId, fromDate, toDate);
    }

    // ── 6. Org Diversity Report ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> diversityReport(UUID companyId) {
        // Everyone currently employed (active, probation and notice), not just
        // ACTIVE. People without a recorded gender are counted as NOT_SPECIFIED
        // instead of silently disappearing from the totals.
        String sql = """
                SELECT
                    d.id                                                 AS department_id,
                    d.name                                               AS department,
                    COALESCE(e.gender, 'NOT_SPECIFIED')                  AS gender,
                    COUNT(*)                                             AS count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY d.id), 2) AS pct
                FROM hrms.employees e
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND e.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD')
                GROUP BY d.id, d.name, COALESCE(e.gender, 'NOT_SPECIFIED')
                ORDER BY d.name, count DESC
                """;
        return jdbc.queryForList(sql, companyId);
    }
}
