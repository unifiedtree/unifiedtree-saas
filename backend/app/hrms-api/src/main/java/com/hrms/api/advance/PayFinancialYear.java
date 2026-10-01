package com.hrms.api.advance;

import com.hrms.api.payroll.PayrollInsights;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.Month;
import java.time.ZoneId;
import java.util.UUID;

/**
 * "This financial year" for the money summaries of advances, PLI and full
 * &amp; final (BW-62–64): the year of the caller's company
 * ({@code org.companies.fiscal_year_start}, April when unset), as the payroll
 * year-to-date uses it. Days are IST.
 */
public record PayFinancialYear(LocalDate start, LocalDate end, String label) {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public static PayFinancialYear of(JdbcTemplate jdbc, UUID tenantId, UUID callerEmployeeId, LocalDate today) {
        String stored = callerEmployeeId == null ? null : jdbc.query("""
                SELECT c.fiscal_year_start FROM hrms.employees e
                  LEFT JOIN org.companies c ON c.id = e.company_id
                 WHERE e.tenant_id = ? AND e.id = ?
                """, rs -> rs.next() ? rs.getString(1) : null, tenantId, callerEmployeeId);
        return of(PayrollInsights.fiscalYearStart(stored), today);
    }

    public static PayFinancialYear of(Month startMonth, LocalDate today) {
        LocalDate[] fy = PayrollInsights.fiscalYear(today, startMonth);
        return new PayFinancialYear(fy[0], fy[1], PayrollInsights.fiscalYearLabel(fy[0]));
    }

    /** The first instant of the year, IST. */
    public Timestamp startsAt() {
        return Timestamp.from(start.atStartOfDay(IST).toInstant());
    }

    /** The first instant after the year, IST. */
    public Timestamp endsBefore() {
        return Timestamp.from(end.plusDays(1).atStartOfDay(IST).toInstant());
    }
}
