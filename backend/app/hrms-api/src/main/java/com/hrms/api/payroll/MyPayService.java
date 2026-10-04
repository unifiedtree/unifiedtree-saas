package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.Month;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The signed-in person's own pay, beyond their payslips (BW-55): the next pay
 * date, this financial year's totals and the month being prepared. Always the
 * caller's own records, found from the employee id in their token; an account
 * without an employee record gets nothing personal.
 *
 * <p>An employee never sees draft or processing figures: totals come from
 * LOCKED and PAID runs only, and the month being prepared carries no amounts.
 */
@Service
public class MyPayService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private Clock clock = Clock.system(IST);

    public MyPayService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Tests pin "today". */
    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    /**
     * Contract C0 (usePaySchedule). {@code nextPayDate}: the next run's pay date
     * for the caller's company, else the next processing day from Payroll
     * settings ("Payroll is processed on {date}"); null when payroll isn't set
     * up. {@code processingDay}: the day of the month payroll is processed.
     */
    public record PayScheduleDto(String nextPayDate, Integer processingDay) {}

    /**
     * This financial year's totals over the caller's LOCKED and PAID payslips.
     * {@code fromPeriod}/{@code toPeriod} ("2026-04") name the first and last
     * month included (null with no payslips yet). {@code tds} is null when no
     * payslip has a TDS line: payroll doesn't calculate income tax yet.
     */
    public record YtdDto(String label, String fyStart, String fyEnd, String fromPeriod, String toPeriod,
                         int payslips, BigDecimal gross, BigDecimal deductions, BigDecimal net,
                         BigDecimal pfEmployee, BigDecimal tds, String taxRegime) {}

    /** A month whose payroll is being prepared for the caller's company. No figures, on purpose. */
    public record UpcomingDto(String period, int periodMonth, int periodYear, String payDate, String status) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public PayScheduleDto schedule(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        LocalDate today = LocalDate.now(clock);
        Map<String, Object> settings = jdbc.query("""
            SELECT payroll_cycle_start_day, salary_processing_day FROM payroll.settings WHERE tenant_id = ?
            """, rs -> rs.next() ? Map.<String, Object>of(
                    "start", rs.getInt("payroll_cycle_start_day"), "day", rs.getInt("salary_processing_day")) : null,
            tenantId);
        Integer processingDay = settings == null ? null : (Integer) settings.get("day");

        UUID companyId = employeeId == null ? null : jdbc.query(
                "SELECT company_id FROM hrms.employees WHERE tenant_id = ? AND id = ?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, tenantId, employeeId);
        Set<String> periodsWithRun = new HashSet<>();
        LocalDate runDate = null;
        if (companyId != null) {
            // The next run that isn't paid yet and whose pay date is still ahead.
            runDate = jdbc.query("""
                SELECT min(pay_date) FROM payroll.runs
                 WHERE tenant_id = ? AND company_id = ? AND status IN ('DRAFT','PROCESSING','LOCKED')
                   AND pay_date >= ?
                """, rs -> rs.next() ? rs.getObject(1, LocalDate.class) : null, tenantId, companyId, today);
            jdbc.query("""
                SELECT period_year, period_month FROM payroll.runs
                 WHERE tenant_id = ? AND company_id = ? AND status <> 'CANCELLED'
                   AND make_date(period_year, period_month, 1) >= ?
                """, (RowCallbackHandler) rs -> periodsWithRun.add(
                        YearMonth.of(rs.getInt("period_year"), rs.getInt("period_month")).toString()),
                tenantId, companyId, today.withDayOfMonth(1).minusMonths(2));
        }
        // A month with no run yet still gets paid on the processing day: a later
        // month's draft created early must not hide this month's payday, so the
        // answer is the nearer of the two.
        LocalDate next = settings == null ? null : PayrollInsights.nextProcessingDate(today,
                (Integer) settings.get("start"), processingDay, periodsWithRun);
        LocalDate nearest = runDate == null ? next : next == null || runDate.isBefore(next) ? runDate : next;
        if (nearest == null) return new PayScheduleDto(null, processingDay);
        return new PayScheduleDto(nearest.toString(), processingDay);
    }

    @Transactional
    public YtdDto ytd(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        LocalDate today = LocalDate.now(clock);
        String stored = employeeId == null ? null : jdbc.query("""
            SELECT c.fiscal_year_start FROM hrms.employees e
              LEFT JOIN org.companies c ON c.id = e.company_id
             WHERE e.tenant_id = ? AND e.id = ?
            """, rs -> rs.next() ? rs.getString(1) : null, tenantId, employeeId);
        Month startMonth = PayrollInsights.fiscalYearStart(stored);
        LocalDate[] fy = PayrollInsights.fiscalYear(today, startMonth);
        String label = PayrollInsights.fiscalYearLabel(fy[0]);
        if (employeeId == null) {
            return new YtdDto(label, fy[0].toString(), fy[1].toString(), null, null, 0,
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, null, null);
        }
        YtdDto sums = jdbc.query("""
            SELECT count(DISTINCT r.id)                                                           AS payslips,
                   min(make_date(r.period_year, r.period_month, 1))                               AS first_month,
                   max(make_date(r.period_year, r.period_month, 1))                               AS last_month,
                   coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')), 0) AS gross,
                   coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'), 0)             AS deductions,
                   coalesce(sum(l.amount) FILTER (WHERE l.component_code = 'PF_EMPLOYEE'), 0)     AS pf,
                   sum(l.amount) FILTER (WHERE l.component_code = 'TDS')                          AS tds
              FROM payroll.runs r
              JOIN payroll.payslip_lines l ON l.run_id = r.id AND l.tenant_id = r.tenant_id AND l.employee_id = ?
             WHERE r.tenant_id = ? AND r.status IN ('LOCKED','PAID')
               AND make_date(r.period_year, r.period_month, 1) BETWEEN ? AND ?
            """, rs -> {
                rs.next();
                BigDecimal gross = rs.getBigDecimal("gross");
                BigDecimal ded = rs.getBigDecimal("deductions");
                LocalDate first = rs.getObject("first_month", LocalDate.class);
                LocalDate last = rs.getObject("last_month", LocalDate.class);
                return new YtdDto(label, fy[0].toString(), fy[1].toString(),
                        first == null ? null : YearMonth.from(first).toString(),
                        last == null ? null : YearMonth.from(last).toString(),
                        rs.getInt("payslips"), gross, ded, gross.subtract(ded), rs.getBigDecimal("pf"),
                        rs.getBigDecimal("tds"), null);
            }, employeeId, tenantId, fy[0], fy[1]);
        String regime = jdbc.query("""
            SELECT tax_regime FROM payroll.employee_salary_structures
             WHERE tenant_id = ? AND employee_id = ? AND is_current IS TRUE
            """, rs -> rs.next() ? rs.getString(1) : null, tenantId, employeeId);
        return new YtdDto(sums.label(), sums.fyStart(), sums.fyEnd(), sums.fromPeriod(), sums.toPeriod(),
                sums.payslips(), sums.gross(), sums.deductions(), sums.net(), sums.pfEmployee(), sums.tds(), regime);
    }

    /**
     * Months being prepared (a DRAFT or PROCESSING run) for the caller's
     * company that fall inside their employment. Period and planned pay date
     * only: never a figure from a run that isn't final.
     */
    @Transactional
    public List<UpcomingDto> upcoming(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        if (employeeId == null) return List.of();
        Map<String, Object> emp = jdbc.query("""
            SELECT company_id, date_of_joining, last_working_day FROM hrms.employees WHERE tenant_id = ? AND id = ?
            """, rs -> {
                if (!rs.next()) return null;
                Map<String, Object> m = new java.util.HashMap<>();
                m.put("company", rs.getObject("company_id", UUID.class));
                m.put("joined", rs.getObject("date_of_joining", LocalDate.class));
                m.put("left", rs.getObject("last_working_day", LocalDate.class));
                return m;
            }, tenantId, employeeId);
        if (emp == null || emp.get("company") == null) return List.of();
        StringBuilder sql = new StringBuilder("""
            SELECT period_month, period_year, pay_date FROM payroll.runs
             WHERE tenant_id = ? AND company_id = ? AND status IN ('DRAFT','PROCESSING')
            """);
        List<Object> args = new ArrayList<>(List.of(tenantId, emp.get("company")));
        if (emp.get("joined") != null) { sql.append(" AND period_end >= ?"); args.add(emp.get("joined")); }
        if (emp.get("left") != null)   { sql.append(" AND period_start <= ?"); args.add(emp.get("left")); }
        sql.append(" ORDER BY period_year, period_month");
        return jdbc.query(sql.toString(), (rs, i) -> new UpcomingDto(
                PayrollInsights.periodLabel(rs.getInt("period_month"), rs.getInt("period_year")),
                rs.getInt("period_month"), rs.getInt("period_year"),
                rs.getObject("pay_date") == null ? null : String.valueOf(rs.getObject("pay_date")),
                "BEING_PREPARED"), args.toArray());
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
