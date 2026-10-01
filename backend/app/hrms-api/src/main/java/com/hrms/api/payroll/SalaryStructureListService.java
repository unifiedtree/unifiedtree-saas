package com.hrms.api.payroll;

import com.hrms.core.dto.PageResponse;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Salary structures for the redesign (BW-56), read-only:
 * <ul>
 *   <li>{@link #summary}: the page's tiles (people with and without a structure,
 *       average annual CTC, revised this financial year, the last bulk revision),</li>
 *   <li>{@link #page}: one page of people with their current structure's figures,
 *       searched and filtered on the server ("No structure"),</li>
 *   <li>{@link #myHistory}: the caller's own salary history with the reason for
 *       each change.</li>
 * </ul>
 * "People" are active employees who haven't left, the same people a payroll run
 * considers. Figures are the structure's full-month preview (PayrollService),
 * never a payslip.
 */
@Service
public class SalaryStructureListService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final int MAX_PAGE_SIZE = 100;

    private final JdbcTemplate jdbc;
    private final PayrollService structures;
    private Clock clock = Clock.system(IST);

    public SalaryStructureListService(JdbcTemplate jdbc, PayrollService structures) {
        this.jdbc = jdbc;
        this.structures = structures;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    /**
     * {@code revisedThisYear}: people whose current structure started in this
     * financial year and replaced an earlier one. {@code lastRevision*}: the
     * latest bulk revision (null when there has been none).
     */
    public record StructureSummaryDto(int activeEmployees, int withStructure, int withoutStructure,
                                      BigDecimal averageCtcAnnual, int revisedThisYear, String fyLabel,
                                      String lastRevisionReason, String lastRevisionEffectiveFrom,
                                      String lastRevisionAt, Integer lastRevisionPeople) {}

    /** One person on the structure list; the money fields are null without a structure. */
    public record StructureRowDto(UUID employeeId, String employeeCode, String employeeName, String department,
                                  String designation, boolean hasStructure, UUID structureId, String effectiveFrom,
                                  BigDecimal ctcAnnual, BigDecimal grossMonthly, BigDecimal netMonthly,
                                  String taxRegime) {}

    /**
     * One structure in the caller's history, newest first. {@code changePercent}
     * is the annual CTC's change from the structure before (null for the first).
     * {@code reason}: the revision note, else the bulk revision's reason.
     */
    public record SalaryHistoryDto(UUID structureId, String effectiveFrom, String effectiveTo, BigDecimal ctcAnnual,
                                   BigDecimal ctcMonthly, BigDecimal changePercent, String reason, boolean current,
                                   String taxRegime) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public StructureSummaryDto summary(UUID tenantId, UUID companyId) {
        bindTenant(tenantId);
        // The company's financial year; without a company, the workspace's first company's.
        String fyStored = companyId == null
                ? jdbc.query("SELECT fiscal_year_start FROM org.companies WHERE tenant_id = ? ORDER BY created_at LIMIT 1",
                        rs -> rs.next() ? rs.getString(1) : null, tenantId)
                : jdbc.query("SELECT fiscal_year_start FROM org.companies WHERE tenant_id = ? AND id = ?",
                        rs -> rs.next() ? rs.getString(1) : null, tenantId, companyId);
        LocalDate[] fy = PayrollInsights.fiscalYear(LocalDate.now(clock), PayrollInsights.fiscalYearStart(fyStored));
        List<Object> args = new ArrayList<>(List.of(fy[0], fy[1], tenantId));
        if (companyId != null) args.add(companyId);
        Map<String, Object> m = jdbc.queryForMap("""
            SELECT count(*)                                              AS active,
                   count(s.id)                                           AS with_structure,
                   avg(s.ctc_annual)                                     AS avg_ctc,
                   count(s.id) FILTER (WHERE s.effective_from BETWEEN ? AND ?
                        AND EXISTS (SELECT 1 FROM payroll.employee_salary_structures o
                                     WHERE o.tenant_id = s.tenant_id AND o.employee_id = s.employee_id
                                       AND o.effective_from < s.effective_from)) AS revised
              FROM hrms.employees e
              LEFT JOIN payroll.employee_salary_structures s
                     ON s.employee_id = e.id AND s.tenant_id = e.tenant_id AND s.is_current IS TRUE
             WHERE e.tenant_id = ? AND e.is_active = TRUE
               AND e.employment_status::text NOT IN ('EXITED','TERMINATED')
            """ + (companyId == null ? "" : " AND e.company_id = ?"), args.toArray());
        int active = ((Number) m.get("active")).intValue();
        int with = ((Number) m.get("with_structure")).intValue();
        BigDecimal avg = m.get("avg_ctc") == null ? null
                : new BigDecimal(m.get("avg_ctc").toString()).setScale(2, RoundingMode.HALF_UP);
        Map<String, Object> last = jdbc.query("""
            SELECT reason, effective_from, created_at, employee_count FROM payroll.salary_revision_batches
             WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1
            """, rs -> {
                if (!rs.next()) return null;
                Map<String, Object> r = new java.util.HashMap<>();
                r.put("reason", rs.getString("reason"));
                r.put("from", String.valueOf(rs.getObject("effective_from")));
                java.sql.Timestamp at = rs.getTimestamp("created_at");
                r.put("at", at == null ? null : at.toInstant().toString());
                r.put("people", rs.getInt("employee_count"));
                return r;
            }, tenantId);
        return new StructureSummaryDto(active, with, active - with, avg, ((Number) m.get("revised")).intValue(),
                PayrollInsights.fiscalYearLabel(fy[0]),
                last == null ? null : (String) last.get("reason"), last == null ? null : (String) last.get("from"),
                last == null ? null : (String) last.get("at"), last == null ? null : (Integer) last.get("people"));
    }

    @Transactional
    public PageResponse<StructureRowDto> page(UUID tenantId, UUID companyId, String q, boolean noStructure,
                                              int page, int size) {
        bindTenant(tenantId);
        int p = Math.max(0, page);
        int n = Math.max(1, Math.min(MAX_PAGE_SIZE, size));
        StringBuilder where = new StringBuilder("""
             WHERE e.tenant_id = ? AND e.is_active = TRUE
               AND e.employment_status::text NOT IN ('EXITED','TERMINATED')
            """);
        List<Object> args = new ArrayList<>(List.of(tenantId));
        if (companyId != null) { where.append(" AND e.company_id = ?"); args.add(companyId); }
        String like = likePattern(q);
        if (like != null) {
            where.append(" AND (lower(concat_ws(' ', e.first_name, e.last_name)) LIKE ? ESCAPE '\\'"
                    + " OR lower(coalesce(e.employee_code, '')) LIKE ? ESCAPE '\\')");
            args.add(like);
            args.add(like);
        }
        if (noStructure) where.append(" AND s.id IS NULL");
        String from = """
              FROM hrms.employees e
              LEFT JOIN payroll.employee_salary_structures s
                     ON s.employee_id = e.id AND s.tenant_id = e.tenant_id AND s.is_current IS TRUE
              LEFT JOIN hrms.departments dp ON dp.id = e.department_id
              LEFT JOIN hrms.designations dg ON dg.id = e.designation_id
            """;
        Long total = jdbc.queryForObject("SELECT count(*) " + from + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(n);
        pageArgs.add((long) p * n);
        List<StructureRowDto> rows = jdbc.query("""
            SELECT e.id, e.employee_code, NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), '') AS name,
                   dp.name AS department, dg.title AS designation,
                   s.id AS structure_id, s.effective_from, s.ctc_annual, s.tax_regime
            """ + from + where + " ORDER BY e.employee_code NULLS LAST, name LIMIT ? OFFSET ?",
            (rs, i) -> new StructureRowDto(rs.getObject("id", UUID.class), rs.getString("employee_code"),
                    rs.getString("name"), rs.getString("department"), rs.getString("designation"),
                    rs.getObject("structure_id") != null, rs.getObject("structure_id", UUID.class),
                    rs.getObject("effective_from") == null ? null : String.valueOf(rs.getObject("effective_from")),
                    rs.getBigDecimal("ctc_annual"), null, null, rs.getString("tax_regime")),
            pageArgs.toArray());
        List<UUID> withStructure = rows.stream().filter(StructureRowDto::hasStructure).map(StructureRowDto::employeeId).toList();
        Map<UUID, PayrollService.StructureDto> current = structures.getCurrentStructures(tenantId, withStructure);
        List<StructureRowDto> content = rows.stream().map(r -> {
            PayrollService.StructureDto d = current.get(r.employeeId());
            return d == null ? r : new StructureRowDto(r.employeeId(), r.employeeCode(), r.employeeName(),
                    r.department(), r.designation(), true, r.structureId(), r.effectiveFrom(), r.ctcAnnual(),
                    d.grossMonthly(), d.netMonthly(), r.taxRegime());
        }).toList();
        long t = total == null ? 0 : total;
        int pages = (int) ((t + n - 1) / n);
        return new PageResponse<>(content, p, n, t, pages, p >= pages - 1);
    }

    @Transactional
    public List<SalaryHistoryDto> myHistory(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        if (employeeId == null) return List.of();
        List<Object[]> raw = jdbc.query("""
            SELECT s.id, s.effective_from, s.effective_to, s.ctc_annual, s.ctc_monthly, s.is_current,
                   s.revision_note, s.tax_regime, b.reason AS batch_reason
              FROM payroll.employee_salary_structures s
              LEFT JOIN payroll.salary_revision_batches b ON b.id = s.revision_batch_id AND b.tenant_id = s.tenant_id
             WHERE s.tenant_id = ? AND s.employee_id = ?
             ORDER BY s.effective_from DESC, s.created_at DESC
            """, (rs, i) -> new Object[]{
                rs.getObject("id", UUID.class),
                rs.getObject("effective_from") == null ? null : String.valueOf(rs.getObject("effective_from")),
                rs.getObject("effective_to") == null ? null : String.valueOf(rs.getObject("effective_to")),
                rs.getBigDecimal("ctc_annual"), rs.getBigDecimal("ctc_monthly"),
                Boolean.TRUE.equals(rs.getObject("is_current")),
                reason(rs.getString("revision_note"), rs.getString("batch_reason")),
                rs.getString("tax_regime")}, tenantId, employeeId);
        List<SalaryHistoryDto> out = new ArrayList<>(raw.size());
        for (int i = 0; i < raw.size(); i++) {
            Object[] r = raw.get(i);
            BigDecimal before = i + 1 < raw.size() ? (BigDecimal) raw.get(i + 1)[3] : null;
            out.add(new SalaryHistoryDto((UUID) r[0], (String) r[1], (String) r[2], (BigDecimal) r[3], (BigDecimal) r[4],
                    PayrollInsights.changePercent((BigDecimal) r[3], before), (String) r[6], (Boolean) r[5], (String) r[7]));
        }
        return out;
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** The revision note, else the bulk revision's reason; null when neither says anything. */
    static String reason(String note, String batchReason) {
        if (note != null && !note.isBlank()) return note.strip();
        if (batchReason != null && !batchReason.isBlank()) return batchReason.strip();
        return null;
    }

    /** A lower-case LIKE pattern for a search, with % and _ taken literally; null for no search. */
    static String likePattern(String q) {
        if (q == null || q.isBlank()) return null;
        String t = q.strip().toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + t + "%";
    }

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
