package com.hrms.app.reports;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Loads the rows behind {@link WorkforceBreakdown}: the headcount report's
 * people on a date (the same STATUS_ON and employedOn SQL as
 * {@link ReportService#headcountReport}, so the breakdowns add up to it) and
 * the joining dates of a period. Read-only; every table is filtered by the
 * request's tenant, bound as a parameter (RLS is the second wall), and every
 * row by the company.
 */
@Service
public class WorkforceBreakdownService {

    private final JdbcTemplate jdbc;

    public WorkforceBreakdownService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public WorkforceBreakdown.Breakdown breakdown(UUID companyId, LocalDate asOf, boolean includeGender) {
        // Buckets exactly as headcountReport splits active / on notice / probation.
        String sql = "WITH " + ReportService.STATUS_ON + """
                SELECT CASE WHEN l.employee_id IS NOT NULL
                              OR COALESCE(s.status, e.employment_status) IN ('NOTICE_PERIOD', 'EXITED', 'TERMINATED', 'RESIGNED') THEN 'NOTICE'
                            WHEN COALESCE(s.status, e.employment_status) = 'ACTIVE'    THEN 'ACTIVE'
                            WHEN COALESCE(s.status, e.employment_status) = 'PROBATION' THEN 'PROBATION'
                            ELSE 'OTHER' END AS bucket,
                       b.name AS branch, g.title AS designation, e.employment_type, e.gender,
                       e.date_of_birth, e.date_of_joining
                  FROM hrms.employees e
                  LEFT JOIN status_on s ON s.employee_id = e.id
                  LEFT JOIN leaving_on l ON l.employee_id = e.id
                  LEFT JOIN org.branches b ON b.id = e.branch_id AND b.tenant_id = ?
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id AND g.tenant_id = ?
                 WHERE e.tenant_id = ?
                   AND e.company_id = ?
                   AND""" + ReportService.employedOn(asOf);
        UUID t = ReportService.tenant();
        List<WorkforceBreakdown.Person> people = jdbc.query(sql, WorkforceBreakdownService::person,
                t, asOf, t, asOf, asOf, t, t, t, companyId, asOf, asOf);
        return WorkforceBreakdown.build(asOf, people, includeGender);
    }

    /** Joiners in each month of [from, to] (whole months), counted up to {@code today}. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> joiners(UUID companyId, LocalDate from, LocalDate to, LocalDate today) {
        LocalDate first = from.withDayOfMonth(1);
        LocalDate last = YearMonth.from(to).atEndOfMonth();
        List<LocalDate> dates = jdbc.query("""
                SELECT e.date_of_joining
                  FROM hrms.employees e
                 WHERE e.tenant_id = ?
                   AND e.company_id = ?
                   AND e.date_of_joining BETWEEN ? AND ?
                """, (rs, i) -> date(rs, "date_of_joining"), ReportService.tenant(), companyId, first, last);
        return WorkforceBreakdown.joinersPerMonth(dates, from, to, today);
    }

    private static WorkforceBreakdown.Person person(ResultSet rs, int i) throws SQLException {
        return new WorkforceBreakdown.Person(rs.getString("bucket"), rs.getString("branch"), rs.getString("designation"),
                rs.getString("employment_type"), rs.getString("gender"),
                date(rs, "date_of_birth"), date(rs, "date_of_joining"));
    }

    private static LocalDate date(ResultSet rs, String column) throws SQLException {
        Date d = rs.getDate(column);
        return d == null ? null : d.toLocalDate();
    }
}
