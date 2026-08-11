package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.letters.service.PdfRenderer;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Payroll reports — client-visible printable summaries of a LOCKED payroll
 * run. Wave 4 (2026-08-11).
 *
 * <p>Wave 4 ships the Salary Register only (the single highest-value report —
 * "give me the entire month's payroll for the audit binder"). Tax / PF-ESI /
 * Variance / xlsx export deferred to Wave 5+.
 *
 * <p>Reuses the existing {@code PdfRenderer} (already used for payslips) so
 * every PDF in the platform is rendered by the same Chrome/wkhtmltopdf
 * pipeline — one thing to configure, one thing to secure.
 */
@Service
public class PayrollReportService {

    private static final Logger log = LoggerFactory.getLogger(PayrollReportService.class);

    private final JdbcTemplate jdbc;
    private final PdfRenderer pdfRenderer;

    public PayrollReportService(JdbcTemplate jdbc, PdfRenderer pdfRenderer) {
        this.jdbc = jdbc;
        this.pdfRenderer = pdfRenderer;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record SalaryRegisterRow(
            String employeeCode, String employeeName, String department,
            BigDecimal paidDays, BigDecimal lopDays,
            BigDecimal gross, BigDecimal deductions, BigDecimal net) {}

    // ── Salary Register PDF ──────────────────────────────────────────────────

    @Transactional
    public byte[] salaryRegisterPdf(UUID tenantId, UUID runId) {
        bindTenant(tenantId);

        // Load run header
        Map<String, Object> run = jdbc.query("""
                SELECT r.period_month, r.period_year, r.status,
                       r.total_gross, r.total_deductions, r.total_net,
                       r.employee_count, c.name AS company_name
                  FROM payroll.runs r
                  LEFT JOIN org.companies c ON c.id = r.company_id
                 WHERE r.id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    Map<String, Object> m = new HashMap<>();
                    m.put("period_month", rs.getInt("period_month"));
                    m.put("period_year", rs.getInt("period_year"));
                    m.put("status", rs.getString("status"));
                    m.put("total_gross", rs.getBigDecimal("total_gross"));
                    m.put("total_deductions", rs.getBigDecimal("total_deductions"));
                    m.put("total_net", rs.getBigDecimal("total_net"));
                    m.put("employee_count", rs.getInt("employee_count"));
                    m.put("company_name", rs.getString("company_name"));
                    return m;
                }, runId);
        if (run == null) throw new BusinessRuleException("Payroll run not found", "RUN_NOT_FOUND");
        // Report only makes sense on LOCKED/PAID runs — DRAFT/PROCESSING numbers move.
        String status = (String) run.get("status");
        if (!"LOCKED".equals(status) && !"PAID".equals(status)) {
            throw new BusinessRuleException(
                    "Salary Register requires a LOCKED or PAID run (current: " + status + ")",
                    "RUN_NOT_LOCKED");
        }

        List<SalaryRegisterRow> rows = jdbc.query("""
                SELECT
                    e.employee_code                                        AS employee_code,
                    TRIM(e.first_name || ' ' || COALESCE(e.last_name,''))  AS employee_name,
                    COALESCE(d.name, '')                                   AS department,
                    ld.paid_days                                           AS paid_days,
                    ld.lop_days                                            AS lop_days,
                    coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')), 0) AS gross,
                    coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'), 0)                 AS deductions,
                    coalesce(sum(l.amount) FILTER (WHERE l.category IN ('EARNING','REIMBURSEMENT')), 0)
                  - coalesce(sum(l.amount) FILTER (WHERE l.category = 'DEDUCTION'), 0)                 AS net
                  FROM payroll.payslip_lines l
                  JOIN hrms.employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                  LEFT JOIN payroll.run_lop_days ld ON ld.run_id = l.run_id AND ld.employee_id = e.id
                 WHERE l.run_id = ?
                 GROUP BY e.employee_code, e.first_name, e.last_name, d.name, ld.paid_days, ld.lop_days
                 ORDER BY e.employee_code ASC
                """, (rs, i) -> new SalaryRegisterRow(
                    rs.getString("employee_code"),
                    rs.getString("employee_name"),
                    rs.getString("department"),
                    rs.getBigDecimal("paid_days"),
                    rs.getBigDecimal("lop_days"),
                    rs.getBigDecimal("gross"),
                    rs.getBigDecimal("deductions"),
                    rs.getBigDecimal("net")), runId);

        String html = renderSalaryRegisterHtml(run, rows);
        byte[] pdf = pdfRenderer.render(html);
        log.info("Generated Salary Register PDF for run {}: {} rows, {} bytes",
                runId, rows.size(), pdf.length);
        return pdf;
    }

    // ── HTML template (kept inline — matches PayrollRunService.renderPayslipHtml style) ──

    private static String renderSalaryRegisterHtml(Map<String, Object> run, List<SalaryRegisterRow> rows) {
        int pm = (int) run.get("period_month");
        int py = (int) run.get("period_year");
        String period = YearMonth.of(py, pm).getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH) + " " + py;
        String company = (String) run.getOrDefault("company_name", "");

        StringBuilder b = new StringBuilder();
        b.append("<!doctype html><html><head><meta charset='utf-8'>");
        b.append("<title>Salary Register — ").append(escapeHtml(company)).append(" ").append(period).append("</title>");
        b.append("<style>");
        b.append("body { font: 10pt 'Segoe UI', Arial, sans-serif; color: #111; margin: 24pt; }");
        b.append("h1 { font-size: 14pt; margin: 0 0 4pt 0; }");
        b.append(".sub { color: #666; font-size: 9pt; margin: 0 0 12pt 0; }");
        b.append("table { width: 100%; border-collapse: collapse; }");
        b.append("th, td { border-bottom: 1px solid #E5E7EB; padding: 5pt 6pt; text-align: left; }");
        b.append("th { background: #F3F4F6; font-weight: 600; font-size: 9pt; }");
        b.append("td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }");
        b.append("tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; padding-top: 8pt; }");
        b.append("</style></head><body>");
        b.append("<h1>Salary Register — ").append(escapeHtml(company)).append("</h1>");
        b.append("<p class='sub'>").append(period);
        b.append(" &nbsp; · &nbsp; Status: ").append(run.get("status"));
        b.append(" &nbsp; · &nbsp; Employees: ").append(run.get("employee_count"));
        b.append("</p>");
        b.append("<table><thead><tr>");
        b.append("<th>Emp Code</th><th>Name</th><th>Department</th>");
        b.append("<th class='num'>Paid Days</th><th class='num'>LOP Days</th>");
        b.append("<th class='num'>Gross (₹)</th><th class='num'>Deductions (₹)</th><th class='num'>Net (₹)</th>");
        b.append("</tr></thead><tbody>");

        BigDecimal totalGross = BigDecimal.ZERO, totalDed = BigDecimal.ZERO, totalNet = BigDecimal.ZERO;
        for (SalaryRegisterRow r : rows) {
            b.append("<tr>");
            b.append("<td>").append(escapeHtml(r.employeeCode())).append("</td>");
            b.append("<td>").append(escapeHtml(r.employeeName())).append("</td>");
            b.append("<td>").append(escapeHtml(r.department())).append("</td>");
            b.append("<td class='num'>").append(nullDash(r.paidDays())).append("</td>");
            b.append("<td class='num'>").append(nullDash(r.lopDays())).append("</td>");
            b.append("<td class='num'>").append(money(r.gross())).append("</td>");
            b.append("<td class='num'>").append(money(r.deductions())).append("</td>");
            b.append("<td class='num'>").append(money(r.net())).append("</td>");
            b.append("</tr>");
            totalGross = totalGross.add(nz(r.gross()));
            totalDed = totalDed.add(nz(r.deductions()));
            totalNet = totalNet.add(nz(r.net()));
        }
        b.append("</tbody><tfoot><tr>");
        b.append("<td colspan='5'>Totals (").append(rows.size()).append(" employee")
         .append(rows.size() == 1 ? "" : "s").append(")</td>");
        b.append("<td class='num'>").append(money(totalGross)).append("</td>");
        b.append("<td class='num'>").append(money(totalDed)).append("</td>");
        b.append("<td class='num'>").append(money(totalNet)).append("</td>");
        b.append("</tr></tfoot></table>");
        b.append("<p class='sub' style='margin-top:16pt'>Generated by UnifiedTree Payroll — ")
         .append(java.time.LocalDate.now()).append("</p>");
        b.append("</body></html>");
        return b.toString();
    }

    private static String nullDash(BigDecimal v) {
        return v == null ? "—" : v.setScale(0, RoundingMode.HALF_UP).toPlainString();
    }
    private static String money(BigDecimal v) {
        return v == null ? "—" : v.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    private static String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
                .replace("\"","&quot;").replace("'","&#39;");
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
