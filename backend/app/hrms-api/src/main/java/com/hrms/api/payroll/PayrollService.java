package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.payroll.service.DefaultComponentSeeder;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * Payroll foundation service (Prompt 12). Raw RLS-scoped JdbcTemplate (no JPA),
 * mirroring ProbationService / WorkspaceAccessService. NO calculation logic.
 */
@Service
public class PayrollService {

    private final JdbcTemplate jdbc;
    private final DefaultComponentSeeder seeder;

    public PayrollService(JdbcTemplate jdbc, DefaultComponentSeeder seeder) {
        this.jdbc = jdbc;
        this.seeder = seeder;
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public record SettingsDto(
        Boolean pfEnabled, BigDecimal pfEmployeePercent, BigDecimal pfEmployerPercent,
        BigDecimal pfWageCeiling, Boolean pfApplyCeiling, String pfEstablishmentCode,
        Boolean esiEnabled, BigDecimal esiEmployeePercent, BigDecimal esiEmployerPercent,
        BigDecimal esiWageCeiling, String esiEstablishmentCode,
        Boolean ptEnabled, String ptStateCode,
        Boolean lwfEnabled, BigDecimal lwfEmployeeAmount, BigDecimal lwfEmployerAmount,
        Boolean sandwichRuleEnabled, Integer lateMarkLopThreshold,
        @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(31) Integer payrollCycleStartDay,
        @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(31) Integer payrollCycleEndDay,
        @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(31) Integer salaryProcessingDay) {}

    public record ComponentDto(
        UUID id, String code, String name, String category, boolean isStatutory, boolean isTaxable,
        String computationType, BigDecimal percentValue, int displayOrder, boolean isSystem, boolean isActive) {}

    public record StructureLineDto(UUID componentId, String componentCode, String componentName,
                                   String category, BigDecimal monthlyAmount) {}

    public record StructureDto(
        UUID id, UUID employeeId, BigDecimal ctcAnnual, BigDecimal ctcMonthly, boolean pfApplicable,
        String pfStatus, String taxRegime, String effectiveFrom, Boolean isCurrent, String revisionNote,
        List<StructureLineDto> lines) {}

    public record PtSlabDto(UUID id, String stateCode, String stateName,
                            BigDecimal minSalary, BigDecimal maxSalary, BigDecimal monthlyTax) {}

    public record CreateStructureRequest(
        @jakarta.validation.constraints.NotNull UUID employeeId,
        @jakarta.validation.constraints.NotNull @jakarta.validation.constraints.Positive BigDecimal ctcAnnual,
        String effectiveFrom,
        @jakarta.validation.constraints.Pattern(regexp = "OLD|NEW", message = "invalid taxRegime") String taxRegime,
        Boolean pfApplicable,
        @jakarta.validation.constraints.Pattern(regexp = "ENROLLED|EXEMPTED_FORM_11|OPTED_OUT_AT_JOINING|NOT_APPLICABLE",
            message = "invalid pfStatus") String pfStatus,
        String revisionNote, List<LineInput> components) {}

    public record LineInput(UUID componentId, BigDecimal monthlyAmount) {}

    public record CreateComponentRequest(
        @jakarta.validation.constraints.NotBlank String code,
        @jakarta.validation.constraints.NotBlank String name,
        @jakarta.validation.constraints.NotBlank
        @jakarta.validation.constraints.Pattern(regexp = "EARNING|DEDUCTION|EMPLOYER_CONTRIBUTION|REIMBURSEMENT",
            message = "invalid category") String category,
        Boolean isStatutory, Boolean isTaxable,
        @jakarta.validation.constraints.NotBlank
        @jakarta.validation.constraints.Pattern(regexp = "FIXED|PERCENT_OF_BASIC|PERCENT_OF_GROSS|FORMULA|STATUTORY",
            message = "invalid computationType") String computationType,
        BigDecimal percentValue, Integer displayOrder) {}

    // ── Settings ────────────────────────────────────────────────────────────

    @Transactional
    public SettingsDto getSettings(UUID tenantId) {
        bindTenant(tenantId);
        ensureSettingsRow(tenantId);
        Map<String, Object> r = jdbc.queryForMap("SELECT * FROM payroll.settings WHERE tenant_id = ?", tenantId);
        return toSettings(r);
    }

    @Transactional
    public SettingsDto updateSettings(UUID tenantId, SettingsDto req) {
        bindTenant(tenantId);
        ensureSettingsRow(tenantId);
        // Overlay only non-null fields onto the existing row.
        jdbc.update("""
            UPDATE payroll.settings SET
                pf_enabled              = COALESCE(?, pf_enabled),
                pf_employee_percent     = COALESCE(?, pf_employee_percent),
                pf_employer_percent     = COALESCE(?, pf_employer_percent),
                pf_wage_ceiling         = COALESCE(?, pf_wage_ceiling),
                pf_apply_ceiling        = COALESCE(?, pf_apply_ceiling),
                pf_establishment_code   = COALESCE(?, pf_establishment_code),
                esi_enabled             = COALESCE(?, esi_enabled),
                esi_employee_percent    = COALESCE(?, esi_employee_percent),
                esi_employer_percent    = COALESCE(?, esi_employer_percent),
                esi_wage_ceiling        = COALESCE(?, esi_wage_ceiling),
                esi_establishment_code  = COALESCE(?, esi_establishment_code),
                pt_enabled              = COALESCE(?, pt_enabled),
                pt_state_code           = COALESCE(?, pt_state_code),
                lwf_enabled             = COALESCE(?, lwf_enabled),
                lwf_employee_amount     = COALESCE(?, lwf_employee_amount),
                lwf_employer_amount     = COALESCE(?, lwf_employer_amount),
                sandwich_rule_enabled   = COALESCE(?, sandwich_rule_enabled),
                late_mark_lop_threshold = ?,
                payroll_cycle_start_day = COALESCE(?, payroll_cycle_start_day),
                payroll_cycle_end_day   = COALESCE(?, payroll_cycle_end_day),
                salary_processing_day   = COALESCE(?, salary_processing_day),
                updated_at = now()
            WHERE tenant_id = ?
            """,
            req.pfEnabled(), req.pfEmployeePercent(), req.pfEmployerPercent(), req.pfWageCeiling(),
            req.pfApplyCeiling(), req.pfEstablishmentCode(),
            req.esiEnabled(), req.esiEmployeePercent(), req.esiEmployerPercent(), req.esiWageCeiling(),
            req.esiEstablishmentCode(),
            req.ptEnabled(), req.ptStateCode(),
            req.lwfEnabled(), req.lwfEmployeeAmount(), req.lwfEmployerAmount(),
            req.sandwichRuleEnabled(), req.lateMarkLopThreshold(),
            req.payrollCycleStartDay(), req.payrollCycleEndDay(), req.salaryProcessingDay(),
            tenantId);
        return getSettingsInline(tenantId);
    }

    private void ensureSettingsRow(UUID tenantId) {
        jdbc.update("INSERT INTO payroll.settings (tenant_id) VALUES (?) ON CONFLICT (tenant_id) DO NOTHING", tenantId);
    }

    private SettingsDto getSettingsInline(UUID tenantId) {
        return toSettings(jdbc.queryForMap("SELECT * FROM payroll.settings WHERE tenant_id = ?", tenantId));
    }

    // ── Components ──────────────────────────────────────────────────────────

    @Transactional
    public List<ComponentDto> listComponents(UUID tenantId) {
        bindTenant(tenantId);
        List<ComponentDto> rows = queryComponents();
        if (rows.isEmpty()) {
            // FIX P0-1: a fresh tenant has no salary components seeded. Auto-seed the 9
            // standard defaults the first time the components page is opened (idempotent),
            // so payroll is configured out-of-the-box. System components can never be
            // deleted, so a zero count only ever means "never seeded".
            //
            // Write-on-read trade-off (chosen over a tenant-create hook so tenants
            // provisioned BEFORE this fix are backfilled too). Two concurrent first-readers
            // can both enter this branch — that is safe: the seeder uses
            // ON CONFLICT (tenant_id, code) DO NOTHING, so the redundant inserts are
            // idempotent (no duplicate rows, no duplicate-key error; the second tx blocks,
            // then no-ops). Only cost is one caller paying for 9 conflict-skipped inserts.
            // Left un-locked deliberately at pilot scale; add pg_advisory_xact_lock(
            // hashtext(tenant_id::text)) here only if it ever shows up as real contention.
            seeder.seedForTenant(tenantId);
            rows = queryComponents();
        }
        return rows;
    }

    private List<ComponentDto> queryComponents() {
        return jdbc.query("SELECT * FROM payroll.salary_components ORDER BY display_order, code",
            (rs, i) -> new ComponentDto(
                rs.getObject("id", UUID.class), rs.getString("code"), rs.getString("name"),
                rs.getString("category"), rs.getBoolean("is_statutory"), rs.getBoolean("is_taxable"),
                rs.getString("computation_type"), rs.getBigDecimal("percent_value"),
                rs.getInt("display_order"), rs.getBoolean("is_system"), rs.getBoolean("is_active")));
    }

    @Transactional
    public int seedDefaults(UUID tenantId) {
        bindTenant(tenantId);
        return seeder.seedForTenant(tenantId);
    }

    @Transactional
    public void createComponent(UUID tenantId, CreateComponentRequest req) {
        bindTenant(tenantId);
        jdbc.update("""
            INSERT INTO payroll.salary_components
                (tenant_id, code, name, category, is_statutory, is_taxable, computation_type, percent_value, display_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tenant_id, code) DO NOTHING
            """,
            tenantId, req.code(), req.name(), req.category(),
            Boolean.TRUE.equals(req.isStatutory()), req.isTaxable() == null || req.isTaxable(),
            req.computationType(), req.percentValue(), req.displayOrder() == null ? 100 : req.displayOrder());
    }

    @Transactional
    public void updateComponent(UUID tenantId, UUID id, CreateComponentRequest req) {
        bindTenant(tenantId);
        // B3 FIX (audit 2026-08-15): reject a category flip on a live /
        // referenced / system component. Changing an EARNING to a DEDUCTION
        // after payslip lines already reference it silently inverts every
        // historical amount (revenue on the P&L flips sign), and system
        // components (BASIC, HRA, ADVANCE_RECOVERY, ...) must never change
        // category. Allow it only when the row is not system AND has zero
        // payslip lines AND zero structure lines pointing at it.
        Map<String, Object> existing = jdbc.queryForMap(
                "SELECT is_system, category FROM payroll.salary_components WHERE id = ?", id);
        if (req.category() != null && !req.category().equals(existing.get("category"))) {
            if (Boolean.TRUE.equals(existing.get("is_system"))) {
                throw new BusinessRuleException(
                        "Cannot change category on system component", "SYSTEM_COMPONENT_CATEGORY_LOCKED");
            }
            Integer refs = jdbc.queryForObject("""
                    SELECT (SELECT count(*) FROM payroll.payslip_lines WHERE component_id = ?)
                         + (SELECT count(*) FROM payroll.employee_structure_components WHERE component_id = ?)
                    """, Integer.class, id, id);
            if (refs != null && refs > 0) {
                throw new BusinessRuleException(
                        "Cannot change category on a component that already has payroll / structure references ("
                        + refs + " row(s)). Retire this component and create a new one.",
                        "COMPONENT_CATEGORY_LOCKED");
            }
        }
        jdbc.update("""
            UPDATE payroll.salary_components SET
                name = COALESCE(?, name),
                category = COALESCE(?, category),
                is_statutory = COALESCE(?, is_statutory),
                is_taxable = COALESCE(?, is_taxable),
                computation_type = COALESCE(?, computation_type),
                percent_value = ?,
                display_order = COALESCE(?, display_order),
                updated_at = now()
            WHERE id = ?
            """,
            req.name(), req.category(), req.isStatutory(), req.isTaxable(),
            req.computationType(), req.percentValue(), req.displayOrder(), id);
    }

    @Transactional
    public void deleteComponent(UUID tenantId, UUID id) {
        bindTenant(tenantId);
        Boolean isSystem = jdbc.query(
            "SELECT is_system FROM payroll.salary_components WHERE id = ?",
            rs -> rs.next() ? rs.getBoolean(1) : null, id);
        if (isSystem == null) throw new BusinessRuleException("Component not found", "COMPONENT_NOT_FOUND");
        if (isSystem) throw new BusinessRuleException("System components cannot be deleted", "SYSTEM_COMPONENT");
        // B3 FIX (audit 2026-08-15): reference pre-check. Deleting a component
        // that any payslip line still references orphans that line (component_id
        // FK becomes invalid on the next payroll re-process, and the run 500s
        // with a friendly-message-free error). Refuse cleanly instead.
        Integer payslipRefs = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.payslip_lines WHERE component_id = ?",
                Integer.class, id);
        if (payslipRefs != null && payslipRefs > 0) {
            throw new BusinessRuleException(
                    "Cannot delete a salary component that is used by " + payslipRefs
                    + " payslip line(s). Archive it instead so historical payroll data is preserved.",
                    "COMPONENT_IN_USE");
        }
        Integer structRefs = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.employee_structure_components WHERE component_id = ?",
                Integer.class, id);
        if (structRefs != null && structRefs > 0) {
            throw new BusinessRuleException(
                    "Cannot delete a salary component that is used by " + structRefs
                    + " employee salary structure(s). Retire it from structures first.",
                    "COMPONENT_IN_USE");
        }
        jdbc.update("DELETE FROM payroll.salary_components WHERE id = ?", id);
    }

    // ── Structures ──────────────────────────────────────────────────────────

    @Transactional
    public StructureDto getCurrentStructure(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT * FROM payroll.employee_salary_structures WHERE employee_id = ? AND is_current IS TRUE", employeeId);
        if (rows.isEmpty()) return null;
        return toStructure(rows.get(0));
    }

    @Transactional
    public List<StructureDto> getStructureHistory(UUID tenantId, UUID employeeId) {
        bindTenant(tenantId);
        return jdbc.queryForList(
            "SELECT * FROM payroll.employee_salary_structures WHERE employee_id = ? ORDER BY effective_from DESC", employeeId)
            .stream().map(this::toStructure).toList();
    }

    @Transactional
    public StructureDto createStructure(UUID tenantId, CreateStructureRequest req) {
        bindTenant(tenantId);
        if (req.employeeId() == null || req.ctcAnnual() == null || req.effectiveFrom() == null) {
            throw new BusinessRuleException("employeeId, ctcAnnual and effectiveFrom are required", "INVALID_STRUCTURE");
        }
        LocalDate effFrom;
        try {
            effFrom = LocalDate.parse(req.effectiveFrom());
        } catch (java.time.format.DateTimeParseException ex) {
            throw new BusinessRuleException("effectiveFrom must be an ISO date (yyyy-MM-dd)", "INVALID_EFFECTIVE_FROM");
        }
        // Demote the existing current structure (TRUE -> NULL leaves the unique slot).
        jdbc.update("""
            UPDATE payroll.employee_salary_structures
               SET is_current = NULL, effective_to = ?, updated_at = now()
             WHERE employee_id = ? AND is_current IS TRUE
            """, effFrom.minusDays(1), req.employeeId());

        BigDecimal ctcMonthly = req.ctcAnnual().divide(new BigDecimal("12"), 2, java.math.RoundingMode.HALF_UP);
        UUID newId = jdbc.queryForObject("""
            INSERT INTO payroll.employee_salary_structures
                (tenant_id, employee_id, ctc_annual, ctc_monthly, pf_applicable, pf_status, tax_regime,
                 revision_note, effective_from, is_current)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
            RETURNING id
            """, UUID.class,
            tenantId, req.employeeId(), req.ctcAnnual(), ctcMonthly,
            req.pfApplicable() == null || req.pfApplicable(),
            req.pfStatus() == null ? "ENROLLED" : req.pfStatus(),
            req.taxRegime() == null ? "NEW" : req.taxRegime(),
            req.revisionNote(), effFrom);

        if (req.components() != null) {
            for (LineInput li : req.components()) {
                jdbc.update("""
                    INSERT INTO payroll.employee_structure_components (structure_id, component_id, monthly_amount)
                    VALUES (?, ?, ?)
                    ON CONFLICT (structure_id, component_id) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount
                    """, newId, li.componentId(), li.monthlyAmount());
            }
        }
        return getCurrentStructure(tenantId, req.employeeId());
    }

    // ── PT slabs (reference, not tenant-scoped) ──────────────────────────────

    @Transactional
    public List<PtSlabDto> getPtSlabs(String stateCode) {
        return jdbc.query(
            "SELECT * FROM payroll.pt_slabs WHERE state_code = ? ORDER BY min_salary",
            (rs, i) -> new PtSlabDto(
                rs.getObject("id", UUID.class), rs.getString("state_code"), rs.getString("state_name"),
                rs.getBigDecimal("min_salary"), rs.getBigDecimal("max_salary"), rs.getBigDecimal("monthly_tax")),
            stateCode);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }

    private StructureDto toStructure(Map<String, Object> r) {
        UUID id = (UUID) r.get("id");
        List<StructureLineDto> lines = jdbc.query("""
            SELECT esc.component_id, esc.monthly_amount, c.code, c.name, c.category
              FROM payroll.employee_structure_components esc
              JOIN payroll.salary_components c ON c.id = esc.component_id
             WHERE esc.structure_id = ?
             ORDER BY c.display_order
            """,
            (rs, i) -> new StructureLineDto(
                rs.getObject("component_id", UUID.class), rs.getString("code"), rs.getString("name"),
                rs.getString("category"), rs.getBigDecimal("monthly_amount")), id);
        Object isCur = r.get("is_current");
        return new StructureDto(
            id, (UUID) r.get("employee_id"), (BigDecimal) r.get("ctc_annual"), (BigDecimal) r.get("ctc_monthly"),
            Boolean.TRUE.equals(r.get("pf_applicable")), (String) r.get("pf_status"), (String) r.get("tax_regime"),
            String.valueOf(r.get("effective_from")), isCur == null ? Boolean.FALSE : (Boolean) isCur,
            (String) r.get("revision_note"), lines);
    }

    private static SettingsDto toSettings(Map<String, Object> r) {
        return new SettingsDto(
            (Boolean) r.get("pf_enabled"), (BigDecimal) r.get("pf_employee_percent"), (BigDecimal) r.get("pf_employer_percent"),
            (BigDecimal) r.get("pf_wage_ceiling"), (Boolean) r.get("pf_apply_ceiling"), (String) r.get("pf_establishment_code"),
            (Boolean) r.get("esi_enabled"), (BigDecimal) r.get("esi_employee_percent"), (BigDecimal) r.get("esi_employer_percent"),
            (BigDecimal) r.get("esi_wage_ceiling"), (String) r.get("esi_establishment_code"),
            (Boolean) r.get("pt_enabled"), (String) r.get("pt_state_code"),
            (Boolean) r.get("lwf_enabled"), (BigDecimal) r.get("lwf_employee_amount"), (BigDecimal) r.get("lwf_employer_amount"),
            (Boolean) r.get("sandwich_rule_enabled"), (Integer) r.get("late_mark_lop_threshold"),
            (Integer) r.get("payroll_cycle_start_day"), (Integer) r.get("payroll_cycle_end_day"),
            (Integer) r.get("salary_processing_day"));
    }
}
