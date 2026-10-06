package com.hrms.api.access;

import com.hrms.api.access.RecordCompanyGuard.Kind;
import com.hrms.api.payroll.PayrollRunController;
import com.hrms.api.payroll.PayrollRunService;
import com.hrms.api.settings.SettingsController;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.RecordOwner;
import com.unifiedtree.settings.service.HolidayService;
import com.unifiedtree.settings.service.HrConfigurationService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Company access, part 3 (COMPANY_ACCESS.md "Records addressed by id"): every
 * endpoint that loads a record by id runs the one shared check first, the guard
 * reads whose the record is from the right table, and a refusal stops the
 * request before anything is read or changed.
 */
class RecordCompanyAccessTest {

    /** Every endpoint covered: controller source, its mapping, and the check its method starts with. */
    static final String[][] COVERED = {
            {"workforce/WorkforceController.java", "@PutMapping(\"/branches/{id}\")", "check(recordGuard, Kind.BRANCH, id)"},
            {"workforce/WorkforceController.java", "@PutMapping(\"/branches/{id}/geofence\")", "check(recordGuard, Kind.BRANCH, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/branches/{id}\")", "check(recordGuard, Kind.BRANCH, id)"},
            {"workforce/WorkforceController.java", "@PatchMapping(\"/departments/{id}/name\")", "check(recordGuard, Kind.DEPARTMENT, id)"},
            {"workforce/WorkforceController.java", "@PatchMapping(\"/departments/{id}/appearance\")", "check(recordGuard, Kind.DEPARTMENT, id)"},
            {"workforce/WorkforceController.java", "@PatchMapping(\"/departments/{id}/details\")", "check(recordGuard, Kind.DEPARTMENT, id)"},
            {"workforce/WorkforceController.java", "@PatchMapping(\"/departments/{id}/head\")", "check(recordGuard, Kind.DEPARTMENT, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/departments/{id}\")", "check(recordGuard, Kind.DEPARTMENT, id)"},
            {"workforce/WorkforceController.java", "@PutMapping(\"/designations/{id}\")", "check(recordGuard, Kind.DESIGNATION, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/designations/{id}\")", "check(recordGuard, Kind.DESIGNATION, id)"},
            {"workforce/WorkforceController.java", "@GetMapping(\"/employees/{id}\")", "checkEmployee(recordGuard, id)"},
            {"workforce/WorkforceController.java", "@PutMapping(\"/employees/{id}\")", "checkEmployee(recordGuard, id)"},
            {"workforce/WorkforceController.java", "@PostMapping(\"/employees/{id}/confirm\")", "checkEmployee(recordGuard, id)"},
            {"workforce/WorkforceController.java", "@PostMapping(\"/employees/{id}/notice\")", "checkEmployee(recordGuard, id)"},
            {"workforce/WorkforceController.java", "@PostMapping(\"/employees/{id}/exit\")", "checkEmployee(recordGuard, id)"},
            {"workforce/WorkforceController.java", "@PostMapping(\"/employees/{id}/cancel-notice\")", "checkEmployee(recordGuard, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/contractors/{id}\")", "check(recordGuard, Kind.CONTRACTOR, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/classifications/{id}\")", "check(recordGuard, Kind.CLASSIFICATION, id)"},
            {"workforce/WorkforceController.java", "@PutMapping(\"/grades/{id}\")", "check(recordGuard, Kind.GRADE, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/grades/{id}\")", "check(recordGuard, Kind.GRADE, id)"},
            {"workforce/WorkforceController.java", "@PutMapping(\"/employment-types/{id}\")", "check(recordGuard, Kind.EMPLOYMENT_TYPE, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/employment-types/{id}\")", "check(recordGuard, Kind.EMPLOYMENT_TYPE, id)"},
            {"workforce/WorkforceController.java", "@PutMapping(\"/shifts/{id}\")", "check(recordGuard, Kind.SHIFT, id)"},
            {"workforce/WorkforceController.java", "@DeleteMapping(\"/shifts/{id}\")", "check(recordGuard, Kind.SHIFT, id)"},
            {"workforce/MasterDataController.java", "@PutMapping(\"/contractors/{id}\")", "check(recordGuard, Kind.CONTRACTOR, id)"},
            {"workforce/MasterDataController.java", "@PostMapping(\"/contractors/{id}/restore\")", "check(recordGuard, Kind.CONTRACTOR, id)"},
            {"workforce/MasterDataController.java", "@GetMapping(\"/contractors/{id}/workers\")", "check(recordGuard, Kind.CONTRACTOR, id)"},
            {"workforce/MasterDataController.java", "@PutMapping(\"/contractors/{id}/workers/{employeeId}\")", "check(recordGuard, Kind.CONTRACTOR, id)"},
            {"workforce/MasterDataController.java", "@DeleteMapping(\"/contractors/{id}/workers/{employeeId}\")", "check(recordGuard, Kind.CONTRACTOR, id)"},
            {"workforce/MasterDataController.java", "@PatchMapping(\"/departments/{id}/parent\")", "check(recordGuard, Kind.DEPARTMENT, id)"},
            {"workforce/MasterDataController.java", "@PutMapping(\"/departments/{id}/branches\")", "check(recordGuard, Kind.DEPARTMENT, id)"},
            {"workforce/MasterDataController.java", "@PutMapping(\"/classifications/{id}\")", "check(recordGuard, Kind.CLASSIFICATION, id)"},
            {"advance/AdvanceController.java", "@PostMapping(\"/requests/on-behalf\")", "checkEmployee(recordGuard, body.employeeId())"},
            {"advance/AdvanceController.java", "@GetMapping(\"/requests/{id}\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceController.java", "@PostMapping(\"/requests/{id}/decision\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceController.java", "@PostMapping(\"/requests/{id}/disburse\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceRecoveryController.java", "@GetMapping(\"/{id}/schedule\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceRecoveryController.java", "@GetMapping(\"/{id}/ledger\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceRecoveryController.java", "@GetMapping(\"/{id}/summary\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceRecoveryController.java", "@PostMapping(\"/{id}/foreclose\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceRecoveryController.java", "@PostMapping(\"/{id}/write-off\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"advance/AdvanceRecoveryController.java", "@PostMapping(\"/{id}/skip-month\")", "check(recordGuard, Kind.ADVANCE, id)"},
            {"document/DocumentController.java", "@PostMapping(\"/documents\")", "checkEmployee(recordGuard, request.employeeId())"},
            {"document/DocumentController.java", "@GetMapping(\"/employee/{employeeId}\")", "checkEmployee(recordGuard, employeeId)"},
            {"document/DocumentController.java", "@GetMapping(\"/documents/{id}\")", "check(recordGuard, Kind.DOCUMENT, id)"},
            {"document/DocumentController.java", "@DeleteMapping(\"/documents/{id}\")", "check(recordGuard, Kind.DOCUMENT, id)"},
            {"document/DocumentController.java", "@PostMapping(\"/documents/{id}/verify\")", "check(recordGuard, Kind.DOCUMENT, id)"},
            {"document/DocumentController.java", "@PostMapping(\"/documents/{id}/reject\")", "check(recordGuard, Kind.DOCUMENT, id)"},
            {"document/DocumentSummaryController.java", "@GetMapping(\"/employee/{employeeId}/summary\")", "checkEmployee(recordGuard, employeeId)"},
            {"expense/ExpenseController.java", "@PostMapping(\"/claims/for/{employeeId}\")", "checkEmployee(recordGuard, employeeId)"},
            {"expense/ExpenseController.java", "@PostMapping(value = \"/receipts/for/{employeeId}\"", "checkEmployee(recordGuard, employeeId)"},
            {"expense/ExpenseController.java", "@GetMapping(\"/employees/{employeeId}/claims\")", "checkEmployee(recordGuard, employeeId)"},
            {"expense/ExpenseController.java", "@GetMapping(\"/claims/{id}\")", "check(recordGuard, Kind.EXPENSE_CLAIM, id)"},
            {"expense/ExpenseController.java", "@PostMapping(\"/claims/{id}/decision\")", "check(recordGuard, Kind.EXPENSE_CLAIM, id)"},
            {"expense/ExpenseController.java", "@PostMapping(\"/claims/{id}/reimburse\")", "check(recordGuard, Kind.EXPENSE_CLAIM, id)"},
            {"expense/ExpenseController.java", "@PutMapping(\"/policies/{id}\")", "check(recordGuard, Kind.EXPENSE_POLICY, id)"},
            {"expense/ExpenseController.java", "@DeleteMapping(\"/policies/{id}\")", "check(recordGuard, Kind.EXPENSE_POLICY, id)"},
            {"fnf/FnfController.java", "@PostMapping(\"/settlements\")", "checkEmployee(recordGuard, request.employeeId())"},
            {"fnf/FnfController.java", "@GetMapping(\"/settlements\")", "checkEmployee(recordGuard, employeeId)"},
            {"fnf/FnfController.java", "@GetMapping(\"/settlements/{id}\")", "check(recordGuard, Kind.FNF_SETTLEMENT, id)"},
            {"fnf/FnfController.java", "@PostMapping(\"/settlements/{id}/approve\")", "check(recordGuard, Kind.FNF_SETTLEMENT, id)"},
            {"fnf/FnfController.java", "@PostMapping(\"/settlements/{id}/pay\")", "check(recordGuard, Kind.FNF_SETTLEMENT, id)"},
            {"fnf/FnfController.java", "@PostMapping(\"/settlements/{id}/cancel\")", "check(recordGuard, Kind.FNF_SETTLEMENT, id)"},
            {"leave/LeaveController.java", "@PostMapping(\"/apply/for/{employeeId}\")", "checkEmployee(recordGuard, employeeId)"},
            {"leave/LeaveController.java", "@PutMapping(\"/types/{id}\")", "check(recordGuard, Kind.LEAVE_TYPE, id)"},
            {"leave/LeaveController.java", "@DeleteMapping(\"/types/{id}\")", "check(recordGuard, Kind.LEAVE_TYPE, id)"},
            {"leave/LeaveTypeApplyController.java", "@GetMapping(\"/{id}/apply-to-all/preview\")", "check(recordGuard, Kind.LEAVE_TYPE, id)"},
            {"leave/LeaveTypeApplyController.java", "@PostMapping(\"/{id}/apply-to-all\")", "check(recordGuard, Kind.LEAVE_TYPE, id)"},
            {"payroll/PayrollRunController.java", "@GetMapping(\"/runs/{id}\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@GetMapping(\"/runs/{id}/eligible-employees\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@GetMapping(\"/runs/{id}/employees\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@GetMapping(\"/runs/{id}/skipped\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@GetMapping(\"/runs/{id}/component-totals\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@PostMapping(\"/runs/{id}/process\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@PostMapping(\"/runs/{id}/lock\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@PostMapping(\"/runs/{id}/reopen\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@GetMapping(\"/runs/{id}/employees/{empId}/payslip\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunController.java", "@GetMapping(\"/runs/{id}/employees/{empId}/payslip.pdf\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunInsightsController.java", "@GetMapping(\"/runs/{id}/checks\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunInsightsController.java", "@GetMapping(\"/runs/{id}/statutory\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunInsightsController.java", "@GetMapping(\"/runs/{id}/bank-readiness\")", "check(recordGuard, Kind.PAYROLL_RUN, id)"},
            {"payroll/PayrollRunInsightsController.java", "@GetMapping(\"/employees/{employeeId}/payslips\")", "checkEmployee(recordGuard, employeeId)"},
            {"pli/PliController.java", "@PutMapping(\"/targets/{id}\")", "check(recordGuard, Kind.PLI_TARGET, id)"},
            {"pli/PliController.java", "@PostMapping(\"/awards\")", "checkEmployee(recordGuard, request.employeeId())"},
            {"pli/PliController.java", "@PostMapping(\"/awards/{id}/decision\")", "check(recordGuard, Kind.PLI_AWARD, id)"},
            {"pli/PliController.java", "@PostMapping(\"/awards/{id}/pay\")", "check(recordGuard, Kind.PLI_AWARD, id)"},
            {"settings/SettingsController.java", "@PutMapping(\"/holidays/{id}\")", "check(recordGuard, Kind.HOLIDAY, id)"},
            {"settings/SettingsController.java", "@DeleteMapping(\"/holidays/{id}\")", "check(recordGuard, Kind.HOLIDAY, id)"},
    };

    @Test
    void everyCoveredEndpointStartsWithTheRecordCheck() throws IOException {
        List<String> problems = new ArrayList<>();
        for (String[] row : COVERED) {
            List<String> lines = Files.readAllLines(Path.of("src/main/java/com/hrms/api", row[0]), StandardCharsets.UTF_8);
            String first = firstStatementAfter(lines, row[1]);
            String normal = first.replace("RecordCompanyGuard.", "").replaceAll(";$", "");
            if (!row[2].equals(normal)) problems.add(row[0] + " " + row[1] + ": " + first);
        }
        assertTrue(problems.isEmpty(), "Endpoints not starting with the record check:\n" + String.join("\n", problems));
        assertEquals(88, COVERED.length);
    }

    /** The first statement of the method under the (unique) annotation, or a description of what went wrong. */
    static String firstStatementAfter(List<String> lines, String annotation) {
        int at = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).trim().startsWith(annotation)) {
                if (at >= 0) return "annotation found twice";
                at = i;
            }
        }
        if (at < 0) return "annotation not found";
        int j = at + 1;
        while (j < lines.size() && !lines.get(j).trim().matches("^(public|private|protected|ResponseEntity|void) .*")) j++;
        while (j < lines.size() && !lines.get(j).stripTrailing().endsWith("{")) j++;
        j++;
        while (j < lines.size() && lines.get(j).isBlank()) j++;
        return j < lines.size() ? lines.get(j).trim() : "no body";
    }

    // ── the guard ───────────────────────────────────────────────────────────

    @Test
    void eachKindReadsItsOwnTable() {
        assertEquals("SELECT company_id, id, reporting_manager_id, NULL::uuid FROM hrms.employees WHERE id = ?",
                Kind.EMPLOYEE.ownerSql());
        assertEquals("SELECT company_id, NULL::uuid, NULL::uuid, NULL::uuid FROM hrms.departments WHERE id = ?",
                Kind.DEPARTMENT.ownerSql());
        assertEquals("SELECT COALESCE(r.company_id, e.company_id), r.employee_id, e.reporting_manager_id, r.approver_id FROM "
                + "expense_mgmt.expense_claims r LEFT JOIN hrms.employees e ON e.id = r.employee_id WHERE r.id = ?",
                Kind.EXPENSE_CLAIM.ownerSql());
        assertTrue(Kind.DOCUMENT.ownerSql().contains("NULL::uuid FROM document_mgmt.employee_documents r"),
                "documents have no approver");
        assertEquals("payroll.runs", Kind.PAYROLL_RUN.table);
        assertEquals("settings.holiday_calendar", Kind.HOLIDAY.table);
        assertEquals("leave_mgmt.leave_types", Kind.LEAVE_TYPE.table);
        for (Kind k : Kind.values()) assertTrue(k.table.matches("[a-z_]+\\.[a-z_]+"), k.table);
    }

    @Test
    @SuppressWarnings("unchecked")
    void theGuardHandsWhoseTheRecordIsToTheSharedCheck() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        CompanyAccessService access = mock(CompanyAccessService.class);
        RecordCompanyGuard guard = new RecordCompanyGuard(jdbc, access);
        UUID id = UUID.randomUUID(), company = UUID.randomUUID(), person = UUID.randomUUID(),
                manager = UUID.randomUUID(), approver = UUID.randomUUID();
        ResultSet rs = mock(ResultSet.class);
        when(rs.next()).thenReturn(true);
        when(rs.getObject(1, UUID.class)).thenReturn(company);
        when(rs.getObject(2, UUID.class)).thenReturn(person);
        when(rs.getObject(3, UUID.class)).thenReturn(manager);
        when(rs.getObject(4, UUID.class)).thenReturn(approver);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs));

        guard.check(Kind.ADVANCE, id);
        ArgumentCaptor<Supplier<RecordOwner>> owner = ArgumentCaptor.forClass(Supplier.class);
        verify(access).checkRecord(eq("Advance request"), eq(id), owner.capture());
        verifyNoInteractions(jdbc);                     // read only when the check asks for it
        assertEquals(new RecordOwner(company, person, manager, approver), owner.getValue().get());
        verify(jdbc).query(eq(Kind.ADVANCE.ownerSql()), any(ResultSetExtractor.class), eq(id));

        guard.checkEmployee(person);
        verify(access).checkRecord(eq("Employee"), eq(person), any());
        guard.check(Kind.SHIFT, null);                  // nothing named: nothing to check
        verifyNoMoreInteractions(access);
    }

    @Test
    void withoutTheBeanTheStaticChecksDoNothing() {
        assertDoesNotThrow(() -> RecordCompanyGuard.check(null, Kind.BRANCH, UUID.randomUUID()));
        assertDoesNotThrow(() -> RecordCompanyGuard.checkEmployee(null, UUID.randomUUID()));
    }

    // ── a refusal stops the request first ──────────────────────────────────

    private static RecordCompanyGuard refusing() {
        RecordCompanyGuard guard = mock(RecordCompanyGuard.class);
        doThrow(new ResourceNotFoundException("Record", "x")).when(guard).check(any(), any());
        doThrow(new ResourceNotFoundException("Employee", "x")).when(guard).checkEmployee(any());
        return guard;
    }

    @Test
    void aPayrollRunOfAnotherCompanyIsNotFoundAndNothingIsRead() {
        PayrollRunService runs = mock(PayrollRunService.class);
        PayrollRunController controller = new PayrollRunController(runs);
        ReflectionTestUtils.setField(controller, "recordGuard", refusing());
        UUID run = UUID.randomUUID();
        assertThrows(ResourceNotFoundException.class, () -> controller.get(run));
        assertThrows(ResourceNotFoundException.class, () -> controller.employees(run));
        verifyNoInteractions(runs);

        RecordCompanyGuard allowing = mock(RecordCompanyGuard.class);
        ReflectionTestUtils.setField(controller, "recordGuard", allowing);
        controller.get(run);
        verify(allowing).check(Kind.PAYROLL_RUN, run);
        verify(runs).getRun(any(), eq(run));
    }

    @Test
    void aHolidayOfAnotherCompanyCannotBeArchived() {
        HolidayService holidays = mock(HolidayService.class);
        SettingsController controller = new SettingsController(mock(HrConfigurationService.class), holidays);
        ReflectionTestUtils.setField(controller, "recordGuard", refusing());
        assertThrows(ResourceNotFoundException.class, () -> controller.archiveHoliday(UUID.randomUUID()));
        verifyNoInteractions(holidays);
    }

    @Test
    void withoutTheGuardControllersBehaveAsBefore() {
        PayrollRunService runs = mock(PayrollRunService.class);
        UUID run = UUID.randomUUID();
        new PayrollRunController(runs).get(run);
        verify(runs).getRun(any(), eq(run));
    }
}
