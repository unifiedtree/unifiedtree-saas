package com.hrms.api.payroll;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Where payroll settings live (V143.105, owner decision 7 Oct 2026: payroll follows the chosen
 * company, so its settings do too).
 *
 * <ul>
 *   <li>{@code payroll.company_settings}: one row per company. The migration copied each
 *       workspace's settings to every company it had, so nothing changed on day one.</li>
 *   <li>{@code payroll.settings}: the workspace row, as before. A company without its own row (one
 *       made after V143.105) uses it, and saving settings for such a company first copies it.</li>
 * </ul>
 *
 * Before V143.105 is applied the company table doesn't exist: every read and write uses the
 * workspace row exactly as before, so the server works whichever is deployed first. The check is
 * {@code to_regclass}, which never raises, so the caller's transaction is never broken by it.
 *
 * <p>Plain JDBC with the caller's transaction; the caller has bound the tenant (row-level security).
 * Not a bean: each payroll service makes its own over its JdbcTemplate, so their constructors (and
 * the tests that build them by hand) stay as they were.
 */
final class PayrollSettingsStore {

    private static final Logger log = LoggerFactory.getLogger(PayrollSettingsStore.class);

    static final String COMPANY_TABLE = "payroll.company_settings";

    /** Every setting column (both tables have them all). */
    static final String COLUMNS = """
            pf_enabled, pf_employee_percent, pf_employer_percent, pf_wage_ceiling, pf_apply_ceiling, pf_establishment_code,
            esi_enabled, esi_employee_percent, esi_employer_percent, esi_wage_ceiling, esi_establishment_code,
            pt_enabled, pt_state_code,
            lwf_enabled, lwf_employee_amount, lwf_employer_amount, lwf_deduction_months,
            sandwich_rule_enabled, late_mark_lop_threshold,
            payroll_cycle_start_day, payroll_cycle_end_day, salary_processing_day, effective_from""";

    private final JdbcTemplate jdbc;
    /** True once the company table has been seen; checked again until then. */
    private volatile boolean companyTableSeen;

    PayrollSettingsStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Whether V143.105 is applied. */
    boolean companyTableReady() {
        if (companyTableSeen) return true;
        Boolean ok = jdbc.queryForObject("SELECT to_regclass('" + COMPANY_TABLE + "') IS NOT NULL", Boolean.class);
        if (Boolean.TRUE.equals(ok)) {
            companyTableSeen = true;
            log.info("Payroll settings: per-company table present (V143.105)");
        }
        return companyTableSeen;
    }

    /** The company's own row, or null (none yet, no company, or V143.105 not applied). */
    Map<String, Object> companyRow(UUID tenantId, UUID companyId) {
        if (companyId == null || !companyTableReady()) return null;
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM " + COMPANY_TABLE + " WHERE tenant_id = ? AND company_id = ?", tenantId, companyId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** The workspace row, or null when the workspace has none yet. */
    Map<String, Object> workspaceRow(UUID tenantId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM payroll.settings WHERE tenant_id = ?", tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** The settings for a company without creating anything: its row, else the workspace row, else null. */
    Map<String, Object> find(UUID tenantId, UUID companyId) {
        Map<String, Object> own = companyRow(tenantId, companyId);
        return own != null ? own : workspaceRow(tenantId);
    }

    /**
     * The settings payroll uses for a company: its row, else the workspace row (created with the
     * defaults when the workspace has none, as the settings screen and payroll always did).
     */
    Map<String, Object> load(UUID tenantId, UUID companyId) {
        Map<String, Object> own = companyRow(tenantId, companyId);
        if (own != null) return own;
        ensureWorkspaceRow(tenantId);
        return jdbc.queryForMap("SELECT * FROM payroll.settings WHERE tenant_id = ?", tenantId);
    }

    void ensureWorkspaceRow(UUID tenantId) {
        jdbc.update("INSERT INTO payroll.settings (tenant_id) VALUES (?) ON CONFLICT (tenant_id) DO NOTHING", tenantId);
    }

    /**
     * Gives the company its own row, a copy of the workspace row, unless it has one; a save then
     * changes that company only. False when it can't (no company, or V143.105 not applied): the
     * caller saves the workspace row, as before.
     */
    boolean ensureCompanyRow(UUID tenantId, UUID companyId) {
        if (companyId == null || !companyTableReady()) return false;
        ensureWorkspaceRow(tenantId);
        jdbc.update("INSERT INTO " + COMPANY_TABLE + " (tenant_id, company_id, " + COLUMNS + ") "
                + "SELECT tenant_id, ?, " + COLUMNS + " FROM payroll.settings WHERE tenant_id = ? "
                + "ON CONFLICT (tenant_id, company_id) DO NOTHING", companyId, tenantId);
        return true;
    }

    /** Whether a company of the current workspace has this id (row-level security narrows to it). */
    boolean companyExists(UUID companyId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE id = ?", Integer.class, companyId);
        return n != null && n > 0;
    }

    /** The workspace's only company, or null when it has none or several. */
    UUID onlyCompany() {
        List<UUID> ids = jdbc.queryForList("SELECT id FROM org.companies LIMIT 2", UUID.class);
        return ids.size() == 1 ? ids.get(0) : null;
    }

    /** The company of an employee, or null. */
    UUID companyOfEmployee(UUID tenantId, UUID employeeId) {
        if (employeeId == null) return null;
        List<UUID> ids = jdbc.queryForList(
                "SELECT company_id FROM hrms.employees WHERE tenant_id = ? AND id = ?", UUID.class, tenantId, employeeId);
        return ids.isEmpty() ? null : ids.get(0);
    }
}
