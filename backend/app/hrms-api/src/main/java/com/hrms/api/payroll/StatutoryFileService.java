package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Statutory file generation. Wave 5 (2026-08-11).
 *
 * <p>Ships EPFO ECR (Electronic Challan cum Return) as the highest-value
 * monthly return every Indian employer needs. Format is EPFO's "#~#"
 * separator layout — the same file the employer uploads to unifiedportal-emp.
 * epfindia.gov.in each month.
 *
 * <p>TDS 24Q, ESI return, and per-state PT files are deferred — they need
 * their own format research + golden-file fixtures. Schema (V080 grants +
 * later migrations) is ready to store their audit records when we add them.
 *
 * <p>Correctness invariants:
 * <ul>
 *   <li>EPF wage ceiling 15000 applied if {@code payroll.settings.pf_apply_ceiling=TRUE}</li>
 *   <li>EPS capped at 15000 always (statutory)</li>
 *   <li>EDLI capped at 15000 always (statutory)</li>
 *   <li>EE = 12% of EPF wages (rounded HALF_UP scale 0 — EPFO wants whole rupees)</li>
 *   <li>EPS = 8.33% of EPS wages</li>
 *   <li>ER share = EE - EPS (the residual on the employer contribution — this is
 *       the EPFO convention, not 3.67%×EPFwages, because both figures come from
 *       the same 12% employer share)</li>
 *   <li>NCP (Non-Contributory Period) = LOP days from run_lop_days</li>
 * </ul>
 */
@Service
public class StatutoryFileService {

    private static final Logger log = LoggerFactory.getLogger(StatutoryFileService.class);

    /** EPFO wage ceiling for EPS + EDLI (Rs 15,000/mo). Statutory, always applied. */
    private static final BigDecimal EPS_CEILING = new BigDecimal("15000");
    private static final BigDecimal EPF_EMPLOYEE_RATE = new BigDecimal("0.12");
    private static final BigDecimal EPS_RATE          = new BigDecimal("0.0833");
    /** EPFO's official field separator: "#~#" (3 chars). */
    private static final String SEP = "#~#";
    /** Row terminator — EPFO ECR uses plain \n (LF, not CRLF). */
    private static final String EOL = "\n";

    private final JdbcTemplate jdbc;

    public StatutoryFileService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTO ───────────────────────────────────────────────────────────────────

    public record EcrEmployeeRow(
            String  uan,             // UAN or all-zeros if missing
            String  memberName,
            BigDecimal grossWages,   // EARNING+REIMBURSEMENT sum minus LOP applied
            BigDecimal epfWages,     // gross capped at 15000 if pf_apply_ceiling
            BigDecimal epsWages,     // gross capped at 15000 (statutory)
            BigDecimal edliWages,    // gross capped at 15000 (statutory)
            BigDecimal eeContrib,    // 12% of epfWages, rounded
            BigDecimal epsContrib,   // 8.33% of epsWages, rounded
            BigDecimal erContrib,    // eeContrib - epsContrib (EPFO convention)
            int     ncpDays,         // LOP days
            BigDecimal refundAdv     // 0 for now — reserved
    ) {}

    // ── PF ECR generator ─────────────────────────────────────────────────────

    @Transactional
    public byte[] generatePfEcr(UUID tenantId, UUID runId) {
        bindTenant(tenantId);

        // Load run header
        Map<String, Object> run = jdbc.query("""
                SELECT r.period_month, r.period_year, r.status, r.company_id
                  FROM payroll.runs r WHERE r.id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    Map<String, Object> m = new HashMap<>();
                    m.put("period_month", rs.getInt("period_month"));
                    m.put("period_year",  rs.getInt("period_year"));
                    m.put("status",       rs.getString("status"));
                    m.put("company_id",   rs.getObject("company_id", UUID.class));
                    return m;
                }, runId);
        if (run == null) throw new BusinessRuleException("Payroll run not found", "RUN_NOT_FOUND");
        String status = (String) run.get("status");
        if (!"LOCKED".equals(status) && !"PAID".equals(status)) {
            throw new BusinessRuleException(
                    "ECR requires a LOCKED or PAID run (current: " + status + ")",
                    "RUN_NOT_LOCKED");
        }

        // Load PF ceiling setting (tenant-scoped)
        boolean applyCeiling = jdbc.query("""
                SELECT pf_apply_ceiling FROM payroll.settings WHERE tenant_id = ?
                """, rs -> rs.next() && rs.getBoolean(1), tenantId);

        // Per-employee aggregate — one row per employee in the run.
        List<EcrEmployeeRow> rows = jdbc.query("""
                SELECT e.pf_uan                                                AS pf_uan,
                       TRIM(e.first_name || ' ' || COALESCE(e.last_name,''))  AS member_name,
                       coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')), 0) AS gross,
                       COALESCE(ld.lop_days, 0)                               AS lop_days
                  FROM payroll.payslip_lines l
                  JOIN hrms.employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
                  LEFT JOIN payroll.run_lop_days ld ON ld.run_id = l.run_id AND ld.employee_id = e.id
                 WHERE l.run_id = ?
                 GROUP BY e.pf_uan, e.first_name, e.last_name, ld.lop_days
                 ORDER BY member_name ASC
                """, (rs, i) -> {
                    BigDecimal gross = rs.getBigDecimal("gross");
                    BigDecimal lopDays = rs.getBigDecimal("lop_days");
                    int ncp = lopDays == null ? 0 : lopDays.setScale(0, RoundingMode.HALF_UP).intValue();

                    BigDecimal epfWages = applyCeiling ? gross.min(EPS_CEILING) : gross;
                    BigDecimal epsWages = gross.min(EPS_CEILING);      // always capped
                    BigDecimal edliWages = gross.min(EPS_CEILING);     // always capped

                    BigDecimal ee = epfWages.multiply(EPF_EMPLOYEE_RATE)
                            .setScale(0, RoundingMode.HALF_UP);
                    BigDecimal eps = epsWages.multiply(EPS_RATE)
                            .setScale(0, RoundingMode.HALF_UP);
                    BigDecimal er = ee.subtract(eps).max(BigDecimal.ZERO);

                    return new EcrEmployeeRow(
                            normaliseUan(rs.getString("pf_uan")),
                            (rs.getString("member_name") == null ? "" : rs.getString("member_name").toUpperCase(Locale.ENGLISH)),
                            gross.setScale(0, RoundingMode.HALF_UP),
                            epfWages.setScale(0, RoundingMode.HALF_UP),
                            epsWages.setScale(0, RoundingMode.HALF_UP),
                            edliWages.setScale(0, RoundingMode.HALF_UP),
                            ee, eps, er,
                            ncp,
                            BigDecimal.ZERO);
                }, runId);

        // Serialise to EPFO ECR text
        StringBuilder out = new StringBuilder();
        for (EcrEmployeeRow r : rows) {
            out.append(r.uan()).append(SEP)
               .append(r.memberName()).append(SEP)
               .append(r.grossWages().toPlainString()).append(SEP)
               .append(r.epfWages().toPlainString()).append(SEP)
               .append(r.epsWages().toPlainString()).append(SEP)
               .append(r.edliWages().toPlainString()).append(SEP)
               .append(r.eeContrib().toPlainString()).append(SEP)
               .append(r.epsContrib().toPlainString()).append(SEP)
               .append(r.erContrib().toPlainString()).append(SEP)
               .append(r.ncpDays()).append(SEP)
               .append(r.refundAdv().toPlainString())
               .append(EOL);
        }
        byte[] bytes = out.toString().getBytes(StandardCharsets.UTF_8);
        log.info("Generated PF ECR for run {}: {} employees, {} bytes",
                runId, rows.size(), bytes.length);
        return bytes;
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * EPFO expects a 12-digit numeric UAN. Employees who haven't been assigned
     * one yet get the placeholder "000000000000" so the row still lands in
     * the file (EPFO ignores it at upload time and prompts to fix — better
     * than dropping the employee entirely).
     */
    private static String normaliseUan(String uan) {
        if (uan == null || uan.isBlank()) return "000000000000";
        String digits = uan.replaceAll("\\D", "");
        if (digits.length() >= 12) return digits.substring(0, 12);
        // Left-pad with zeros to 12 chars (some UANs come through without
        // leading zeros in older HR imports).
        return "0".repeat(12 - digits.length()) + digits;
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
