package com.hrms.api.workforce.search;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.api.workforce.search.GlobalSearchDtos.GlobalSearchResponse;
import com.hrms.api.workforce.search.GlobalSearchDtos.SearchHit;
import com.hrms.api.workforce.search.GlobalSearchQueries.LeaveRow;
import com.hrms.api.workforce.search.GlobalSearchQueries.PayslipRow;
import com.hrms.api.workforce.search.GlobalSearchQueries.Scope;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchHit;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchResponse;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/**
 * Server-side permission filtering of the top bar's search: which lookups run,
 * how far each reaches, and where each result links. The SQL itself is
 * exercised against a real database by e2e/recovery/live-w3-search.mjs.
 */
class GlobalSearchServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID me = UUID.randomUUID(), teammate = UUID.randomUUID();

    private GlobalSearchQueries queries;
    private WorkforceEmployeeService employees;
    private TeamEmployeeScope teamScope;
    private TenantModuleLookup modules;
    private GlobalSearchService service;

    @BeforeEach
    void setUp() {
        queries = mock(GlobalSearchQueries.class);
        employees = mock(WorkforceEmployeeService.class);
        teamScope = mock(TeamEmployeeScope.class);
        modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), anyString())).thenReturn(true);
        when(employees.search(anyString(), anyInt())).thenReturn(new EmployeeSearchResponse(List.of(), 5, false));
        service = new GlobalSearchService(queries, employees, teamScope, modules, mock(PlatformTransactionManager.class));
    }

    private static Jwt jwt(UUID employeeId) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString());
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        return b.build();
    }

    private GlobalSearchResponse search(String q, Set<String> perms, UUID employeeId) {
        Jwt j = jwt(employeeId);
        return service.search(q, 5, j, new TestingAuthenticationToken(j, null, perms.toArray(String[]::new)), tenant);
    }

    private static Employee employee(UUID id) {
        Employee e = new Employee();
        e.setId(id);
        return e;
    }

    private LeaveRow leave(UUID employeeId) {
        return new LeaveRow(UUID.randomUUID(), employeeId, "Ravi Kumar", "EMP-7", "Casual Leave",
                LocalDate.of(2026, 9, 12), LocalDate.of(2026, 9, 14), 3.0, "PENDING");
    }

    @Test
    void anEmployeeOnlyEverSearchesTheirOwnRecords() {
        search("ravi", GlobalSearchAccessTest.EMPLOYEE, me);

        Scope own = Scope.only(List.of(me));
        verify(queries).leave(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).expenses(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).payslips(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).documents(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).letters(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).policies(eq(tenant), eq(true), anyList(), anyInt());
        // Never the directory, hiring, or anyone else's records.
        verifyNoInteractions(employees, teamScope);
        verify(queries, never()).candidates(any(), anyList(), anyInt());
        verify(queries, never()).offers(any(), anyList(), anyInt());
        verify(queries, never()).jobs(any(), anyList(), anyInt());
        verify(queries, never()).leave(any(), eq(Scope.EVERYONE), anyList(), anyInt());
        verify(queries, never()).payslips(any(), eq(Scope.EVERYONE), anyList(), anyInt());
    }

    @Test
    void aLoginWithoutAnEmployeeRecordFindsOnlyPublishedPolicies() {
        search("ravi", GlobalSearchAccessTest.EMPLOYEE, null);
        verify(queries).policies(eq(tenant), eq(true), anyList(), anyInt());
        verify(queries, never()).leave(any(), any(), anyList(), anyInt());
        verify(queries, never()).payslips(any(), any(), anyList(), anyInt());
        verify(queries, never()).documents(any(), any(), anyList(), anyInt());
        verifyNoInteractions(employees);
    }

    @Test
    void aManagerSearchesTheirTeamAndThemselvesOnly() {
        when(teamScope.resolve(any(), isNull())).thenReturn(List.of(employee(teammate)));
        search("ravi", GlobalSearchAccessTest.MANAGER, me);

        ArgumentCaptor<Scope> scope = ArgumentCaptor.forClass(Scope.class);
        verify(queries).leave(eq(tenant), scope.capture(), anyList(), anyInt());
        assertThat(scope.getValue().people()).containsExactlyInAnyOrder(teammate, me);
        verify(queries).expenses(eq(tenant), eq(scope.getValue()), anyList(), anyInt());
        // Their own payslips and documents only; the team scope is resolved once.
        verify(queries).payslips(eq(tenant), eq(Scope.only(List.of(me))), anyList(), anyInt());
        verify(queries).documents(eq(tenant), eq(Scope.only(List.of(me))), anyList(), anyInt());
        verify(teamScope, times(1)).resolve(any(), isNull());
        verify(queries).candidates(eq(tenant), anyList(), anyInt());
        verify(queries, never()).offers(any(), anyList(), anyInt());
        verifyNoInteractions(employees);
    }

    @Test
    void hrSearchesPeopleAndEveryonesRecords() {
        when(employees.search("ravi", 5)).thenReturn(new EmployeeSearchResponse(
                List.of(new EmployeeSearchHit(teammate, "Ravi Kumar", "EMP-7", "Sales", "Executive", null)), 5, false));
        GlobalSearchResponse res = search("ravi", GlobalSearchAccessTest.HR, me);

        verify(queries).leave(eq(tenant), eq(Scope.EVERYONE), anyList(), anyInt());
        verify(queries).payslips(eq(tenant), eq(Scope.EVERYONE), anyList(), anyInt());
        verify(queries).policies(eq(tenant), eq(false), anyList(), anyInt());
        verify(queries).offers(eq(tenant), anyList(), anyInt());
        verifyNoInteractions(teamScope);
        assertThat(res.groups()).extracting("type").containsExactly("employee");
        SearchHit person = res.groups().get(0).items().get(0);
        assertThat(person.url()).isEqualTo("/hrms/employees?q=ravi");
        assertThat(person.subtitle()).isEqualTo("EMP-7 · Sales · Executive");
    }

    @Test
    void ownRecordsOpenSelfServiceAndOthersOpenTheirWorkspace() {
        when(teamScope.resolve(any(), isNull())).thenReturn(List.of(employee(teammate)));
        when(queries.leave(any(), any(), anyList(), anyInt())).thenReturn(List.of(leave(me), leave(teammate)));
        GlobalSearchResponse res = search("casual", GlobalSearchAccessTest.MANAGER, me);

        List<SearchHit> hits = res.groups().stream().filter(g -> g.type().equals("leave")).findFirst().orElseThrow().items();
        assertThat(hits.get(0).url()).isEqualTo("/hrms/leave?tab=my");
        assertThat(hits.get(0).title()).isEqualTo("Casual Leave");
        assertThat(hits.get(1).url()).isEqualTo("/hrms/employees/" + teammate + "?tab=leave");
        assertThat(hits.get(1).title()).isEqualTo("Ravi Kumar · Casual Leave");
        assertThat(hits.get(1).subtitle()).isEqualTo("12 Sep – 14 Sep 2026 · 3 days · EMP-7");
        assertThat(hits.get(1).badge()).isEqualTo("Pending");
    }

    @Test
    void payslipLinksOpenTheRunSearchedByCodeOrYourOwnPayslips() {
        UUID run = UUID.randomUUID();
        when(queries.payslips(any(), any(), anyList(), anyInt()))
                .thenReturn(List.of(new PayslipRow(run, teammate, "Ravi Kumar", "EMP-7", 9, 2026, "LOCKED")));
        SearchHit admin = search("ravi", GlobalSearchAccessTest.HR, me).groups().stream()
                .filter(g -> g.type().equals("payslip")).findFirst().orElseThrow().items().get(0);
        assertThat(admin.url()).isEqualTo("/hrms/payroll/runs/" + run + "?tab=employees&q=EMP-7");
        assertThat(admin.title()).isEqualTo("Payslip · September 2026");

        SearchHit own = search("september", GlobalSearchAccessTest.EMPLOYEE, me).groups().stream()
                .filter(g -> g.type().equals("payslip")).findFirst().orElseThrow().items().get(0);
        assertThat(own.url()).isEqualTo("/me/payslips");
        assertThat(own.subtitle()).isEqualTo("Your payslip");
    }

    @Test
    void theWordPayslipsAloneDoesNotListTheWholeCompanysPayslips() {
        search("payslips", GlobalSearchAccessTest.HR, me);
        verify(queries, never()).payslips(any(), any(), anyList(), anyInt());
        // An employee's own list is fine.
        search("payslips", GlobalSearchAccessTest.EMPLOYEE, me);
        verify(queries).payslips(eq(tenant), eq(Scope.only(List.of(me))), eq(List.of()), anyInt());
    }

    @Test
    void aFailingLookupIsReportedAndTheOthersStillAnswer() {
        when(queries.leave(any(), any(), anyList(), anyInt())).thenThrow(new DataAccessResourceFailureException("down"));
        when(queries.documents(any(), any(), anyList(), anyInt())).thenReturn(List.of(
                new GlobalSearchQueries.DocumentRow(UUID.randomUUID(), me, "Me", "EMP-1", "Aadhaar card", "Aadhaar", "ID_PROOF", "VERIFIED")));
        GlobalSearchResponse res = search("aadhaar", GlobalSearchAccessTest.EMPLOYEE, me);
        assertThat(res.unavailable()).containsExactly("leave");
        assertThat(res.groups()).extracting("type").containsExactly("document");
        assertThat(res.groups().get(0).items().get(0).url()).isEqualTo("/hrms/documents?view=my");
    }

    @Test
    void typesWhoseModuleIsOffAreNotSearched() {
        when(modules.hasActiveModule(tenant, "payroll")).thenReturn(false);
        search("ravi", GlobalSearchAccessTest.HR, me);
        verify(queries, never()).payslips(any(), any(), anyList(), anyInt());
        verify(queries).leave(any(), any(), anyList(), anyInt());
    }

    @Test
    void shortQueriesAndMissingTenantsReturnNothing() {
        assertThatThrownBy(() -> search("a", GlobalSearchAccessTest.HR, me)).isInstanceOf(IllegalArgumentException.class);
        Jwt j = jwt(me);
        GlobalSearchResponse res = service.search("ravi", 5, j, new TestingAuthenticationToken(j, null, "hrms.employee.read"), null);
        assertThat(res.groups()).isEmpty();
        verifyNoInteractions(queries, employees);
    }

    @Test
    void theDirectoryLinkKeepsWhatWasTypedWhenTheDirectoryWillFindItWithIt() {
        EmployeeSearchHit ravi = new EmployeeSearchHit(teammate, "Ravi Kumar", "EMP-7", "Sales", "Executive", null);
        assertThat(GlobalSearchService.directoryQuery(ravi, SearchText.of("Ravi Ku"))).isEqualTo("ravi ku");
        assertThat(GlobalSearchService.directoryQuery(ravi, SearchText.of("emp-7"))).isEqualTo("emp-7");
        // Word-by-word matches the directory can't reproduce fall back to the code.
        assertThat(GlobalSearchService.directoryQuery(ravi, SearchText.of("sales ravi"))).isEqualTo("EMP-7");
        assertThat(GlobalSearchService.enc("ravi kumar & co")).isEqualTo("ravi%20kumar%20%26%20co");
    }

    @Test
    void policiesLinkToTheListSearchedByTitleOnTheRightTab() {
        UUID id = UUID.randomUUID();
        SearchHit draft = GlobalSearchService.policyHit(new GlobalSearchQueries.PolicyRow(id, "Leave Policy", "LEAVE", "2", "DRAFT", null),
                GlobalSearchAccess.Reach.ALL);
        assertThat(draft.url()).isEqualTo("/hrms/policies?q=Leave%20Policy&status=Draft&policy=" + id);
        assertThat(draft.badge()).isEqualTo("Draft");
        SearchHit live = GlobalSearchService.policyHit(new GlobalSearchQueries.PolicyRow(id, "Leave Policy", "LEAVE", "2", "ACTIVE", null),
                GlobalSearchAccess.Reach.PUBLISHED);
        assertThat(live.badge()).isNull();
        verify(queries, never()).policies(any(), anyBoolean(), anyList(), anyInt());
    }
}
