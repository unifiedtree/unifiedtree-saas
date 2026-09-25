package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * Every current salary structure in the workspace, one row per person, with
 * CTC and each configured component's monthly amount (Salary Structure →
 * Export). The web page turns the JSON into an Excel workbook; {@link #csv}
 * gives the same table as CSV for {@code ?format=csv}.
 *
 * <p>Statutory deductions (PF / ESI / PT) are not structure lines — payroll
 * works them out when it runs — so they are not columns here.
 */
@Service
public class SalaryStructureExportService {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    public SalaryStructureExportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ColumnDto(String code, String name, String category) {}

    public record ExportRowDto(UUID employeeId, String employeeCode, String name, String company, String department,
                               String designation, String grade, String employmentStatus, String effectiveFrom,
                               BigDecimal ctcAnnual, BigDecimal ctcMonthly, BigDecimal grossMonthly, boolean derivedFromCtc,
                               String taxRegime, boolean pfApplicable, Map<String, BigDecimal> amounts) {}

    public record ExportDto(String generatedOn, List<ColumnDto> components, List<ExportRowDto> rows) {}

    @Transactional(readOnly = true)
    public ExportDto export(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");

        List<Map<String, Object>> structures = jdbc.queryForList("""
                SELECT s.id AS structure_id, e.id AS employee_id, e.employee_code,
                       trim(concat_ws(' ', e.first_name, e.last_name)) AS name,
                       c.name AS company_name, d.name AS department_name, g.title AS designation,
                       NULLIF(trim(g.grade), '') AS grade, e.employment_status::text AS employment_status,
                       s.effective_from, s.ctc_annual, s.ctc_monthly, s.tax_regime, s.pf_applicable
                  FROM payroll.employee_salary_structures s
                  JOIN hrms.employees e ON e.id = s.employee_id
                  LEFT JOIN org.companies c ON c.id = e.company_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id
                 WHERE s.tenant_id = ? AND s.is_current IS TRUE
                 ORDER BY e.employee_code
                """, tenantId);

        // Every configured line of those structures, and the components they use (in payslip order).
        Map<UUID, Map<String, BigDecimal>> amounts = new HashMap<>();
        Map<UUID, BigDecimal> gross = new HashMap<>();
        LinkedHashMap<String, ColumnDto> columns = new LinkedHashMap<>();
        jdbc.query("""
                SELECT esc.structure_id, esc.monthly_amount, c.code, c.name, c.category
                  FROM payroll.employee_structure_components esc
                  JOIN payroll.salary_components c ON c.id = esc.component_id
                  JOIN payroll.employee_salary_structures s ON s.id = esc.structure_id
                 WHERE s.tenant_id = ? AND s.is_current IS TRUE
                 ORDER BY c.display_order, c.code
                """, rs -> {
            UUID sid = rs.getObject("structure_id", UUID.class);
            String code = rs.getString("code"), category = rs.getString("category");
            BigDecimal amt = rs.getBigDecimal("monthly_amount");
            columns.putIfAbsent(code, new ColumnDto(code, rs.getString("name"), category));
            amounts.computeIfAbsent(sid, k -> new LinkedHashMap<>()).merge(code, amt == null ? BigDecimal.ZERO : amt, BigDecimal::add);
            if (SalaryRevisionPlanner.isGrossLine(category) && amt != null) gross.merge(sid, amt, BigDecimal::add);
        }, tenantId);

        List<ExportRowDto> rows = new ArrayList<>(structures.size());
        for (Map<String, Object> r : structures) {
            UUID sid = (UUID) r.get("structure_id");
            boolean derived = !gross.containsKey(sid);
            BigDecimal ctcMonthly = (BigDecimal) r.get("ctc_monthly");
            rows.add(new ExportRowDto((UUID) r.get("employee_id"), (String) r.get("employee_code"), (String) r.get("name"),
                    (String) r.get("company_name"), (String) r.get("department_name"), (String) r.get("designation"),
                    (String) r.get("grade"), (String) r.get("employment_status"), String.valueOf(r.get("effective_from")),
                    (BigDecimal) r.get("ctc_annual"), ctcMonthly, derived ? ctcMonthly : gross.get(sid), derived,
                    (String) r.get("tax_regime"), Boolean.TRUE.equals(r.get("pf_applicable")),
                    amounts.getOrDefault(sid, Map.of())));
        }
        return new ExportDto(LocalDate.now(IST).toString(), List.copyOf(columns.values()), rows);
    }

    /** The export as CSV: one header row, one row per person, amounts in rupees. */
    public static String csv(ExportDto x) {
        List<String> head = new ArrayList<>(List.of("Employee code", "Employee name", "Company", "Department", "Designation",
                "Grade", "Status", "Effective from", "Annual CTC", "Monthly CTC"));
        for (ColumnDto c : x.components()) head.add(c.name() + " (monthly)");
        head.addAll(List.of("Gross monthly", "Structure", "Tax regime", "PF"));
        StringBuilder sb = new StringBuilder();
        sb.append(String.join(",", head.stream().map(SalaryStructureExportService::cell).toList())).append("\r\n");
        for (ExportRowDto r : x.rows()) {
            List<String> row = new ArrayList<>(List.of(cell(r.employeeCode()), cell(r.name()), cell(r.company()),
                    cell(r.department()), cell(r.designation()), cell(r.grade()), cell(status(r.employmentStatus())),
                    cell(r.effectiveFrom()), money(r.ctcAnnual()), money(r.ctcMonthly())));
            for (ColumnDto c : x.components()) {
                BigDecimal v = r.amounts().get(c.code());
                row.add(v == null ? "" : money(v));
            }
            row.add(money(r.grossMonthly()));
            row.add(cell(r.derivedFromCtc() ? "From CTC (no components)" : "Component split"));
            row.add(cell(r.taxRegime() == null ? "" : r.taxRegime() + " regime"));
            row.add(cell(r.pfApplicable() ? "Yes" : "No"));
            sb.append(String.join(",", row)).append("\r\n");
        }
        return sb.toString();
    }

    private static String status(String s) {
        if (s == null || s.isBlank()) return "";
        String t = s.replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(t.charAt(0)) + t.substring(1);
    }

    private static String money(BigDecimal v) {
        return v == null ? "" : v.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }

    /** A CSV text cell: quoted when needed; a leading = + - @ is neutralised so spreadsheets don't run it. */
    static String cell(String v) {
        String s = v == null ? "" : v;
        if (!s.isEmpty() && "=+-@\t\r".indexOf(s.charAt(0)) >= 0) s = "'" + s;
        return s.matches("(?s).*[\",\n\r'].*") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }
}
