package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Payroll dashboard aggregates. Powers the four KPI cards + 6-month cost trend
 * chart on the Payroll landing page.
 *
 * <p>Wave 1 (2026-08-11). Reads live from {@code payroll.runs} +
 * {@code payroll.payslip_lines} + {@code payroll.disbursement_batches} so the
 * numbers never diverge from the ledger. Same {@code bindTenant} pattern as
 * PayrollRunService — SET LOCAL app.tenant_id INSIDE a live @Transactional
 * (never readOnly=true; readOnly can silently drop the GUC in some drivers
 * and RLS then returns zero rows — see MEMORY: rls-after-commit-trap).
 *
 * <p>Money numbers are BigDecimal end-to-end. Divisions use explicit scale + HALF_UP.
 */
@Service
public class PayrollDashboardService {

    /** Component code for tax deducted at source. Matches the seeded DEDUCTION code in DefaultComponentSeeder. */
    private static final String TDS_COMPONENT_CODE = "TDS";

    /**
     * Statuses considered "pending disbursal" for the KPI card. LOCKED = payroll
     * numbers are frozen but no bank batch has been posted yet; PROCESSING =
     * numbers still being computed but the run is committed to the current
     * period. PAID / DRAFT / CANCELLED are deliberately excluded — PAID has
     * already moved money, DRAFT hasn't committed yet, CANCELLED never will.
     */
    private static final List<String> PENDING_DISBURSAL_STATUSES = List.of("PROCESSING", "LOCKED");

    private final JdbcTemplate jdbc;

    public PayrollDashboardService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record KpisDto(
            BigDecimal totalPayrollCost,   // sum(gross + employer contributions) for currentPeriod
            BigDecimal averageSalary,      // totalPayrollCost / distinct employee count (2 dp, HALF_UP)
            int        pendingDisbursals,  // count of runs in PROCESSING or LOCKED — no PAID batch yet
            BigDecimal tdsLiability,       // sum of TDS payslip_lines for currentPeriod
            String     currentPeriodLabel, // "AUG 2026"
            int        currentPeriodMonth,
            int        currentPeriodYear) {}

    public record TrendPointDto(
            int        periodMonth,
            int        periodYear,
            String     label,               // "MAR", "APR", ...  (short month name)
            BigDecimal totalPayrollCost,    // 0 if no run for this period, never null
            int        runCount             // number of runs contributing (multi-company tenants)
    ) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * "Current period" is the LATEST period that has at least one run in any
     * status. If no runs exist at all we return zeros with a period label of
     * the current calendar month — so the dashboard doesn't crash on a fresh
     * tenant.
     */
    @Transactional
    public KpisDto kpis(UUID tenantId) {
        bindTenant(tenantId);

        Map<String, Object> current = jdbc.query("""
                SELECT r.period_month AS pm, r.period_year AS py
                  FROM payroll.runs r
                 ORDER BY r.period_year DESC, r.period_month DESC
                 LIMIT 1
                """, rs -> rs.next() ? Map.of("pm", rs.getInt("pm"), "py", rs.getInt("py")) : null);

        int pm, py;
        if (current == null) {
            YearMonth now = YearMonth.now();
            pm = now.getMonthValue();
            py = now.getYear();
        } else {
            pm = (int) current.get("pm");
            py = (int) current.get("py");
        }

        // Total cost = sum of all EARNING + REIMBURSEMENT + EMPLOYER_CONTRIBUTION
        // for the current period. Employer contribution is the true tenant cost
        // and belongs in "total payroll cost" — even though it never appears on
        // the employee's payslip (see MyPayslipDto).
        BigDecimal totalCost = jdbc.queryForObject("""
                SELECT COALESCE(SUM(l.amount) FILTER (
                    WHERE l.category IN ('EARNING','REIMBURSEMENT','EMPLOYER_CONTRIBUTION')
                ), 0)
                  FROM payroll.runs r
                  JOIN payroll.payslip_lines l ON l.run_id = r.id
                 WHERE r.period_month = ? AND r.period_year = ?
                """, BigDecimal.class, pm, py);

        Integer empCount = jdbc.queryForObject("""
                SELECT COUNT(DISTINCT l.employee_id)
                  FROM payroll.runs r
                  JOIN payroll.payslip_lines l ON l.run_id = r.id
                 WHERE r.period_month = ? AND r.period_year = ?
                """, Integer.class, pm, py);
        empCount = empCount == null ? 0 : empCount;

        BigDecimal avg = empCount == 0
                ? BigDecimal.ZERO
                : totalCost.divide(new BigDecimal(empCount), 2, java.math.RoundingMode.HALF_UP);

        BigDecimal tds = jdbc.queryForObject("""
                SELECT COALESCE(SUM(l.amount), 0)
                  FROM payroll.runs r
                  JOIN payroll.payslip_lines l ON l.run_id = r.id
                 WHERE r.period_month = ? AND r.period_year = ?
                   AND l.component_code = ?
                """, BigDecimal.class, pm, py, TDS_COMPONENT_CODE);

        // Pending disbursals = runs that are PROCESSING or LOCKED and DO NOT
        // yet have a POSTED or PAID batch in payroll.disbursement_batches.
        // (Wave 2 adds the batch build; today the LEFT JOIN just returns NULL
        // and every PROCESSING/LOCKED run counts as pending, which is the
        // correct current-state answer.)
        Integer pending = jdbc.queryForObject("""
                SELECT COUNT(*)
                  FROM payroll.runs r
                 WHERE r.status = ANY (?::text[])
                   AND NOT EXISTS (
                        SELECT 1 FROM payroll.disbursement_batches b
                         WHERE b.run_id = r.id
                           AND b.status IN ('POSTED','PAID'))
                """, Integer.class, PENDING_DISBURSAL_STATUSES.toArray(String[]::new));
        pending = pending == null ? 0 : pending;

        return new KpisDto(totalCost, avg, pending, tds,
                periodLabel(pm, py), pm, py);
    }

    /**
     * 6-month cost trend ending at the most recent run's period (or the
     * current calendar month if there are no runs yet). Always returns exactly
     * {@code months} rows — periods with no run come back with zeros so the
     * chart draws a continuous line.
     */
    @Transactional
    public List<TrendPointDto> trend(UUID tenantId, int months) {
        bindTenant(tenantId);
        if (months < 1) months = 1;
        if (months > 24) months = 24;   // guardrail — no reason for a longer trend

        Map<String, Object> latest = jdbc.query("""
                SELECT r.period_month AS pm, r.period_year AS py
                  FROM payroll.runs r
                 ORDER BY r.period_year DESC, r.period_month DESC
                 LIMIT 1
                """, rs -> rs.next() ? Map.of("pm", rs.getInt("pm"), "py", rs.getInt("py")) : null);

        YearMonth end = latest == null
                ? YearMonth.now()
                : YearMonth.of((int) latest.get("py"), (int) latest.get("pm"));

        // Build the trailing N periods first, then fill any that have data.
        List<TrendPointDto> out = new ArrayList<>(months);
        Map<Long, Map<String, Object>> byKey = new java.util.HashMap<>();
        jdbc.query("""
                SELECT r.period_month AS pm, r.period_year AS py,
                       COUNT(DISTINCT r.id)                                      AS run_count,
                       COALESCE(SUM(l.amount) FILTER (
                           WHERE l.category IN ('EARNING','REIMBURSEMENT','EMPLOYER_CONTRIBUTION')
                       ), 0)                                                     AS total_cost
                  FROM payroll.runs r
                  LEFT JOIN payroll.payslip_lines l ON l.run_id = r.id
                 GROUP BY r.period_month, r.period_year
                """, rs -> {
            int pm = rs.getInt("pm"), py = rs.getInt("py");
            long key = (long) py * 100L + pm;
            byKey.put(key, Map.of(
                    "run_count", rs.getInt("run_count"),
                    "total_cost", rs.getBigDecimal("total_cost")));
        });

        for (int i = months - 1; i >= 0; i--) {
            YearMonth ym = end.minusMonths(i);
            long key = (long) ym.getYear() * 100L + ym.getMonthValue();
            Map<String, Object> hit = byKey.get(key);
            BigDecimal cost = hit == null ? BigDecimal.ZERO : (BigDecimal) hit.get("total_cost");
            int rc = hit == null ? 0 : (int) hit.get("run_count");
            out.add(new TrendPointDto(
                    ym.getMonthValue(), ym.getYear(),
                    ym.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH).toUpperCase(Locale.ENGLISH),
                    cost, rc));
        }
        return out;
    }

    // ── helpers (mirror PayrollRunService verbatim so behaviour matches) ─────

    private static String periodLabel(int month, int year) {
        return YearMonth.of(year, month)
                .getMonth()
                .getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
                .toUpperCase(Locale.ENGLISH) + " " + year;
    }

    /**
     * Bind tenant into BOTH TenantContext holders + SET LOCAL app.tenant_id.
     * Copied verbatim from PayrollRunService — the ceremony has to match every
     * other payroll service or reads via RLS get wrong results.
     */
    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        // SET LOCAL doesn't accept parameter binds; tenantId is a validated UUID
        // so string concatenation is injection-safe.
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
