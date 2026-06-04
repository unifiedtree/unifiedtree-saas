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
        String sql = """
                SELECT
                    d.name                          AS department,
                    COUNT(e.id)                     AS total,
                    SUM(CASE WHEN e.employment_status = 'ACTIVE'     THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN e.employment_status = 'ON_NOTICE'  THEN 1 ELSE 0 END) AS on_notice,
                    SUM(CASE WHEN e.employment_status = 'PROBATION'  THEN 1 ELSE 0 END) AS probation
                FROM hrms.employees e
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND e.date_of_joining <= ?
                  AND (e.date_of_termination IS NULL OR e.date_of_termination > ?)
                GROUP BY d.name
                ORDER BY total DESC
                """;
        return jdbc.queryForList(sql, companyId, asOf, asOf);
    }

    // ── 2. Attrition Report ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> attritionReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        String sql = """
                SELECT
                    TO_CHAR(e.date_of_termination, 'YYYY-MM')           AS month,
                    COUNT(*)                                             AS exits,
                    SUM(CASE WHEN e.employment_status = 'RESIGNED'  THEN 1 ELSE 0 END) AS resignations,
                    SUM(CASE WHEN e.employment_status = 'TERMINATED' THEN 1 ELSE 0 END) AS terminations,
                    ROUND(
                        COUNT(*) * 100.0 / NULLIF(
                            -- MAX() wraps the outer column so the correlated subquery is valid
                            -- under GROUP BY (the raw e.date_of_termination is not a grouped column).
                            (SELECT COUNT(*) FROM hrms.employees
                             WHERE company_id = e.company_id
                               AND date_of_joining <= MAX(e.date_of_termination)
                               AND (date_of_termination IS NULL OR date_of_termination > MAX(e.date_of_termination))
                            ), 0
                        ), 2
                    )                                                    AS attrition_pct
                FROM hrms.employees e
                WHERE e.company_id = ?
                  AND e.date_of_termination BETWEEN ? AND ?
                GROUP BY TO_CHAR(e.date_of_termination, 'YYYY-MM'), e.company_id
                ORDER BY month
                """;
        return jdbc.queryForList(sql, companyId, fromDate, toDate);
    }

    // ── 3. Attendance Summary Report ─────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> attendanceSummaryReport(UUID companyId, LocalDate fromDate, LocalDate toDate) {
        String sql = """
                SELECT
                    e.employee_code,
                    e.first_name || ' ' || e.last_name                  AS employee_name,
                    d.name                                               AS department,
                    COUNT(ar.id)                                         AS present_days,
                    SUM(CASE WHEN ar.attendance_status = 'LATE' THEN 1 ELSE 0 END) AS late_days,
                    ROUND(AVG(ar.work_hours)::numeric, 2)                AS avg_hours,
                    SUM(ar.overtime_minutes)                             AS total_overtime_mins
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
                    e.first_name || ' ' || e.last_name                  AS employee_name,
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
                    e.first_name || ' ' || e.last_name                  AS employee_name,
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
        String sql = """
                SELECT
                    d.name                                               AS department,
                    e.gender,
                    COUNT(*)                                             AS count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY d.name), 2) AS pct
                FROM hrms.employees e
                LEFT JOIN hrms.departments d ON d.id = e.department_id
                WHERE e.company_id = ?
                  AND e.employment_status = 'ACTIVE'
                  AND e.gender IS NOT NULL
                GROUP BY d.name, e.gender
                ORDER BY d.name, count DESC
                """;
        return jdbc.queryForList(sql, companyId);
    }
}
