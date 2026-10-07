package com.hrms.api.payroll;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.advance.AdvanceRecoveryService;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.letters.service.PdfRenderer;
import com.hrms.payroll.service.DefaultComponentSeeder;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Payroll settings per company (V143.105, owner decision 7 Oct 2026): a company reads and saves its
 * own row, a company without one uses the workspace row, the server behaves as before until the
 * migration is applied, and payroll runs use their company's settings.
 */
class PayrollSettingsPerCompanyTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CO_A = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID CO_B = UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");

    private JdbcTemplate jdbc;
    private PayrollService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        service = new PayrollService(jdbc, mock(DefaultComponentSeeder.class));
        companies(CO_A, CO_B);
        doReturn(1).when(jdbc).queryForObject(contains("FROM org.companies WHERE id = ?"), eq(Integer.class), any(UUID.class));
    }

    @AfterEach
    void clear() {
        CompanyContext.clear();
        TenantContext.clear();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Map<String, Object> row(int processingDay, boolean pf) {
        Map<String, Object> r = new HashMap<>();
        r.put("pf_enabled", pf);
        r.put("pf_employee_percent", new BigDecimal("12.000"));
        r.put("pf_employer_percent", new BigDecimal("12.000"));
        r.put("pf_wage_ceiling", new BigDecimal("15000.00"));
        r.put("pf_apply_ceiling", true);
        r.put("esi_enabled", false);
        r.put("esi_employee_percent", new BigDecimal("0.750"));
        r.put("esi_employer_percent", new BigDecimal("3.250"));
        r.put("esi_wage_ceiling", new BigDecimal("21000.00"));
        r.put("pt_enabled", false);
        r.put("lwf_enabled", false);
        r.put("sandwich_rule_enabled", false);
        r.put("payroll_cycle_start_day", 1);
        r.put("payroll_cycle_end_day", 31);
        r.put("salary_processing_day", processingDay);
        return r;
    }

    private void migrationApplied(boolean applied) {
        doReturn(applied).when(jdbc).queryForObject(contains("to_regclass('payroll.company_settings')"), eq(Boolean.class));
    }

    private void companies(UUID... ids) {
        doReturn(List.of(ids).subList(0, Math.min(2, ids.length)))
                .when(jdbc).queryForList(contains("SELECT id FROM org.companies"), eq(UUID.class));
    }

    private void companyRow(UUID company, Map<String, Object> r) {
        doReturn(r == null ? List.of() : List.of(r))
                .when(jdbc).queryForList(contains("FROM payroll.company_settings"), eq(TENANT), eq(company));
    }

    private void workspaceRow(Map<String, Object> r) {
        doReturn(r).when(jdbc).queryForMap(contains("FROM payroll.settings"), eq(TENANT));
    }

    private static PayrollService.SettingsDto processingDay(int day) {
        return new PayrollService.SettingsDto(null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, day, null);
    }

    private List<String> updates() {
        List<String> sql = new ArrayList<>();
        mockingDetails(jdbc).getInvocations().forEach(inv -> {
            if (inv.getMethod().getName().equals("update")) sql.add(String.valueOf(inv.getArguments()[0]));
        });
        return sql;
    }

    // ── reads ────────────────────────────────────────────────────────────────

    @Test
    void aCompanyReadsItsOwnRow() {
        migrationApplied(true);
        companyRow(CO_B, row(5, true));
        workspaceRow(row(28, false));

        PayrollService.SettingsDto s = service.getSettings(TENANT, CO_B);

        assertEquals(5, s.salaryProcessingDay());
        assertTrue(s.pfEnabled());
        verify(jdbc, never()).queryForMap(contains("FROM payroll.settings"), any(Object[].class));
    }

    @Test
    void twoCompaniesOfOneWorkspaceReadDifferentSettings() {
        migrationApplied(true);
        companyRow(CO_A, row(28, false));
        companyRow(CO_B, row(5, true));

        assertEquals(28, service.getSettings(TENANT, CO_A).salaryProcessingDay());
        assertEquals(5, service.getSettings(TENANT, CO_B).salaryProcessingDay());
    }

    @Test
    void aCompanyWithoutItsOwnRowFallsBackToTheWorkspaceRow() {
        migrationApplied(true);
        companyRow(CO_B, null);
        workspaceRow(row(28, false));

        assertEquals(28, service.getSettings(TENANT, CO_B).salaryProcessingDay());
        // The workspace row is created with the defaults when missing, as before; no company row is made by a read.
        verify(jdbc).update(contains("INSERT INTO payroll.settings (tenant_id)"), eq(TENANT));
        verify(jdbc, never()).update(contains("INSERT INTO payroll.company_settings"), any(Object[].class));
    }

    @Test
    void beforeTheMigrationEveryCompanyReadsTheWorkspaceRow() {
        migrationApplied(false);
        workspaceRow(row(28, false));

        assertEquals(28, service.getSettings(TENANT, CO_B).salaryProcessingDay());
        verify(jdbc, never()).queryForList(contains("payroll.company_settings"), any(Object[].class));
    }

    @Test
    void noCompanyInAOneCompanyWorkspaceMeansThatCompany() {
        migrationApplied(true);
        companies(CO_A);
        companyRow(CO_A, row(7, false));
        workspaceRow(row(28, false));

        assertEquals(7, service.getSettings(TENANT, null).salaryProcessingDay());
    }

    @Test
    void noCompanyInAMultiCompanyWorkspaceMeansTheWorkspaceRow() {
        migrationApplied(true);
        workspaceRow(row(28, false));

        assertEquals(28, service.getSettings(TENANT, null).salaryProcessingDay());
        verify(jdbc, never()).queryForList(contains("payroll.company_settings"), any(Object[].class));
    }

    @Test
    void aCompanyOfAnotherWorkspaceIsNotFound() {
        UUID stranger = UUID.randomUUID();
        doReturn(0).when(jdbc).queryForObject(contains("FROM org.companies WHERE id = ?"), eq(Integer.class), eq(stranger));

        assertThrows(ResourceNotFoundException.class, () -> service.getSettings(TENANT, stranger));
        assertThrows(ResourceNotFoundException.class, () -> service.updateSettings(TENANT, stranger, processingDay(5)));
        assertTrue(updates().stream().noneMatch(s -> s.contains("payroll.")), "nothing written: " + updates());
    }

    // ── writes ───────────────────────────────────────────────────────────────

    @Test
    void savingForACompanyChangesOnlyThatCompanysRow() {
        migrationApplied(true);
        companyRow(CO_B, row(5, false));

        assertEquals(5, service.updateSettings(TENANT, CO_B, processingDay(5)).salaryProcessingDay());

        // Its row is made from the workspace row first (a no-op when it exists) ...
        verify(jdbc).update(argThat((String sql) -> sql.contains("INSERT INTO payroll.company_settings")
                        && sql.contains("FROM payroll.settings WHERE tenant_id = ?")
                        && sql.contains("ON CONFLICT (tenant_id, company_id) DO NOTHING")),
                eq(CO_B), eq(TENANT));
        // ... then only it is updated.
        List<String> updates = updates();
        assertTrue(updates.stream().anyMatch(s -> s.contains("UPDATE payroll.company_settings SET")), updates.toString());
        assertTrue(updates.stream().filter(s -> s.contains("UPDATE payroll.company_settings"))
                .allMatch(s -> s.contains("WHERE tenant_id = ? AND company_id = ?")), updates.toString());
        assertTrue(updates.stream().noneMatch(s -> s.contains("UPDATE payroll.settings")), "the workspace row is untouched: " + updates);
    }

    @Test
    void savingWithoutACompanyInAMultiCompanyWorkspaceSavesTheWorkspaceRow() {
        migrationApplied(true);
        workspaceRow(row(9, false));

        assertEquals(9, service.updateSettings(TENANT, processingDay(9)).salaryProcessingDay());

        List<String> updates = updates();
        assertTrue(updates.stream().anyMatch(s -> s.contains("UPDATE payroll.settings SET")), updates.toString());
        assertTrue(updates.stream().noneMatch(s -> s.contains("payroll.company_settings")), updates.toString());
    }

    @Test
    void beforeTheMigrationASaveForACompanySavesTheWorkspaceRowAsBefore() {
        migrationApplied(false);
        workspaceRow(row(9, false));

        assertEquals(9, service.updateSettings(TENANT, CO_B, processingDay(9)).salaryProcessingDay());

        List<String> updates = updates();
        assertTrue(updates.stream().anyMatch(s -> s.contains("UPDATE payroll.settings SET")), updates.toString());
        assertTrue(updates.stream().noneMatch(s -> s.contains("payroll.company_settings")), updates.toString());
    }

    // ── which company a request is for ───────────────────────────────────────

    @Test
    void theRequestsCompanyIsTheParameterThenTheHeaderThenTheHomeCompany() {
        PayrollSettingsController controller = new PayrollSettingsController(service);
        CompanyAccessService access = mock(CompanyAccessService.class);
        when(access.currentCompanyId()).thenReturn(CO_A);

        // No access service (bare controller) and no header: the service decides.
        assertNull(controller.company(null));

        ReflectionTestUtils.setField(controller, "companyAccess", access);
        assertEquals(CO_A, controller.company(null), "the caller's home company");

        CompanyContext.setCompanyId(CO_B);
        assertEquals(CO_B, controller.company(null), "the company chosen with X-Company-Id");

        UUID explicit = UUID.randomUUID();
        assertEquals(explicit, controller.company(explicit), "an explicit companyId wins");

        CompanyContext.clear();
        when(access.currentCompanyId()).thenThrow(new IllegalStateException("No signed-in user"));
        assertNull(controller.company(null));
    }

    // ── payroll uses the run's company's settings ────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void aNewRunTakesItsPayDateFromItsCompanysSettings() {
        PayrollRunService runs = new PayrollRunService(jdbc, mock(PdfRenderer.class), new ObjectMapper(),
                mock(DefaultComponentSeeder.class), mock(AdvanceRecoveryService.class));
        migrationApplied(true);
        companyRow(CO_B, row(5, false));   // company B pays on the 5th
        companyRow(CO_A, null);            // company A has no row: the workspace's 28th
        workspaceRow(row(28, false));
        AtomicReference<Object[]> insert = new AtomicReference<>();
        doAnswer(inv -> {
            insert.set(Arrays.copyOfRange(inv.getArguments(), 2, inv.getArguments().length));
            return UUID.randomUUID();
        }).when(jdbc).query(contains("INSERT INTO payroll.runs"), any(ResultSetExtractor.class), any(Object[].class));
        PayrollRunService.RunDto dto = new PayrollRunService.RunDto(UUID.randomUUID(), CO_B, "B", 11, 2026, null, null,
                "DRAFT", 0, null, null, null, null, null, null, 0, null, null, null, null, null, null, null, null);
        doReturn(List.of(dto)).when(jdbc).query(contains("WHERE r.id = ?"), any(RowMapper.class), any(Object[].class));

        runs.createDraftRun(TENANT, new PayrollRunService.CreateRunRequest(CO_B, 11, 2026), null);
        assertEquals(LocalDate.of(2026, 11, 5), insert.get()[7], "pay date of company B's run");

        runs.createDraftRun(TENANT, new PayrollRunService.CreateRunRequest(CO_A, 11, 2026), null);
        assertEquals(LocalDate.of(2026, 11, 28), insert.get()[7], "pay date of company A's run (workspace row)");
    }

    @Test
    @SuppressWarnings("unchecked")
    void theSalaryStructurePreviewUsesThePersonsCompanysSettings() {
        UUID person = UUID.randomUUID();
        TenantContext.setTenantId(TENANT);
        migrationApplied(true);
        companyRow(CO_B, row(5, true));    // PF on in company B
        workspaceRow(row(28, false));      // PF off in the workspace row
        doReturn(List.of(CO_B)).when(jdbc).queryForList(contains("SELECT company_id FROM hrms.employees"), eq(UUID.class), eq(TENANT), eq(person));
        Map<String, Object> structure = new HashMap<>();
        structure.put("id", UUID.randomUUID());
        structure.put("employee_id", person);
        structure.put("ctc_monthly", new BigDecimal("30000"));
        structure.put("ctc_annual", new BigDecimal("360000"));
        structure.put("pf_status", "ENROLLED");
        structure.put("pf_applicable", true);
        structure.put("is_current", true);
        doReturn(structure).when(jdbc).queryForMap(contains("employee_salary_structures"), any(Object[].class));
        doReturn(List.of(structure)).when(jdbc).queryForList(contains("employee_salary_structures"), any(Object[].class));

        PayrollService.StructureDto dto = service.getCurrentStructure(TENANT, person);

        assertNotNull(dto);
        assertEquals(Boolean.TRUE, dto.pfOn(), "company B's PF switch, not the workspace's");
    }

    // ── the migration ────────────────────────────────────────────────────────

    @Test
    void v143_105CopiesEachWorkspacesSettingsToEveryCompanyOnce() throws Exception {
        String sql = Files.readString(Path.of(
                "../hrms-app/src/main/resources/db/canonical/V143_105__payroll_settings_per_company.sql"));
        assertTrue(sql.contains("CREATE TABLE IF NOT EXISTS payroll.company_settings"));
        assertTrue(sql.contains("PRIMARY KEY (tenant_id, company_id)"), "one row per company");
        assertTrue(sql.contains("FORCE ROW LEVEL SECURITY") && sql.contains("current_tenant_id()"), "tenant isolation");
        assertFalse(sql.contains("ALTER TABLE payroll.settings"), "the workspace table is not changed");
        assertFalse(sql.contains("DELETE FROM"), "nothing is deleted");

        String copy = sql.substring(sql.indexOf("INSERT INTO payroll.company_settings"));
        assertTrue(copy.contains("FROM payroll.settings s"));
        assertTrue(copy.contains("JOIN org.companies c ON c.tenant_id = s.tenant_id"), "every company of the workspace");
        assertTrue(copy.contains("ON CONFLICT (tenant_id, company_id) DO NOTHING"), "idempotent, never overwrites");

        // The copy carries every setting the server reads and copies (PayrollSettingsStore.COLUMNS).
        Set<String> stored = columns(PayrollSettingsStore.COLUMNS);
        String insertCols = copy.substring(copy.indexOf('(') + 1, copy.indexOf(')'));
        Set<String> copied = columns(insertCols);
        copied.removeAll(Set.of("tenant_id", "company_id"));
        assertEquals(stored, copied);
        // ... which are all of payroll.settings' setting columns (V046 + V143.11).
        assertEquals(columns("""
                pf_enabled, pf_employee_percent, pf_employer_percent, pf_wage_ceiling, pf_apply_ceiling, pf_establishment_code,
                esi_enabled, esi_employee_percent, esi_employer_percent, esi_wage_ceiling, esi_establishment_code,
                pt_enabled, pt_state_code, lwf_enabled, lwf_employee_amount, lwf_employer_amount, sandwich_rule_enabled,
                late_mark_lop_threshold, payroll_cycle_start_day, payroll_cycle_end_day, salary_processing_day,
                effective_from, lwf_deduction_months"""), stored);
        for (String c : stored) assertTrue(sql.contains("    " + c + " "), "the table has " + c);
    }

    private static Set<String> columns(String list) {
        return Arrays.stream(list.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .collect(Collectors.toCollection(TreeSet::new));
    }
}
