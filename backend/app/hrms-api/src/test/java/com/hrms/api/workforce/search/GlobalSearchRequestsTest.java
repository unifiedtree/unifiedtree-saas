package com.hrms.api.workforce.search;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.api.workforce.search.GlobalSearchAccess.Reach;
import com.hrms.api.workforce.search.GlobalSearchDtos.SearchHit;
import com.hrms.api.workforce.search.GlobalSearchQueries.Scope;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchResponse;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.SqlProvider;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static com.hrms.api.workforce.search.GlobalSearchAccess.reach;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/**
 * The request search types (work from home, shift changes, attendance fixes, advances, overtime):
 * each reaches exactly as far as its own list page, each query is fenced by the caller's tenant,
 * and each result opens the right page.
 */
class GlobalSearchRequestsTest {

    // ── reach: the same rule as each list page ───────────────────────────────

    static final Set<String> SELF = Set.of("wfh.request.self", "attendance.checkin.self", "hrms.advance.request.self");
    static final Set<String> MANAGER = with(SELF, "wfh.approve", "attendance.regularization.approve", "attendance.team.read", "hrms.advance.approve");
    static final Set<String> HR = with(MANAGER, "hrms.leave.approve.l2", "attendance.workforce.admin", "hrms.advance.read", "hrms.advance.disburse");

    static Set<String> with(Set<String> base, String... more) {
        Set<String> s = new HashSet<>(base);
        s.addAll(List.of(more));
        return Set.copyOf(s);
    }

    static final SearchType[] REQUESTS = { SearchType.WFH, SearchType.SHIFT_CHANGE, SearchType.CORRECTION, SearchType.ADVANCE, SearchType.OVERTIME_REQUEST };

    @Test
    void anEmployeeReachesOnlyTheirOwnRequests() {
        for (SearchType t : REQUESTS) assertThat(reach(t, SELF, true)).as(t.key).isEqualTo(Reach.OWN);
        // The EMPLOYEE role without these self permissions finds none of them.
        for (SearchType t : REQUESTS) assertThat(reach(t, GlobalSearchAccessTest.EMPLOYEE, true)).as(t.key).isEqualTo(Reach.NONE);
    }

    @Test
    void aManagerReachesTheirTeamAndAdvancesRoutedToThem() {
        assertThat(reach(SearchType.WFH, MANAGER, true)).isEqualTo(Reach.TEAM);
        assertThat(reach(SearchType.SHIFT_CHANGE, MANAGER, true)).isEqualTo(Reach.TEAM);
        assertThat(reach(SearchType.CORRECTION, MANAGER, true)).isEqualTo(Reach.TEAM);
        assertThat(reach(SearchType.OVERTIME_REQUEST, MANAGER, true)).isEqualTo(Reach.TEAM);
        // DEPT_MANAGER holds approve without disburse: only advances routed to them (AdvanceController).
        assertThat(reach(SearchType.ADVANCE, MANAGER, true)).isEqualTo(Reach.ROUTED);
    }

    @Test
    void hrReachesEveryoneWhereTheListIsTenantWide() {
        assertThat(reach(SearchType.WFH, HR, true)).isEqualTo(Reach.ALL);          // l2 widens /pending-approvals
        assertThat(reach(SearchType.SHIFT_CHANGE, HR, true)).isEqualTo(Reach.ALL); // workforce admin: approverScope() = everyone
        assertThat(reach(SearchType.ADVANCE, HR, true)).isEqualTo(Reach.ALL);      // disburse sees every advance
        // These lists are always TeamEmployeeScope (company-wide for workforce admins) on their pages.
        assertThat(reach(SearchType.CORRECTION, HR, true)).isEqualTo(Reach.TEAM);
        assertThat(reach(SearchType.OVERTIME_REQUEST, HR, true)).isEqualTo(Reach.TEAM);
    }

    @Test
    void withoutAnEmployeeRecordOnlyTheTenantWideListsReach() {
        assertThat(reach(SearchType.WFH, HR, false)).isEqualTo(Reach.ALL);
        assertThat(reach(SearchType.ADVANCE, HR, false)).isEqualTo(Reach.ALL);
        for (SearchType t : REQUESTS) {
            assertThat(reach(t, MANAGER, false)).as(t.key).isEqualTo(Reach.NONE);
            assertThat(reach(t, Set.of(), true)).as(t.key).isEqualTo(Reach.NONE);
        }
    }

    // ── the service passes exactly that scope, always with the caller's tenant ──

    private final UUID tenant = UUID.randomUUID();
    private final UUID me = UUID.randomUUID(), teammate = UUID.randomUUID();
    private GlobalSearchQueries queries;
    private TeamEmployeeScope teamScope;
    private GlobalSearchService service;

    @BeforeEach
    void setUp() {
        queries = mock(GlobalSearchQueries.class);
        WorkforceEmployeeService employees = mock(WorkforceEmployeeService.class);
        when(employees.search(anyString(), anyInt())).thenReturn(new EmployeeSearchResponse(List.of(), 5, false));
        teamScope = mock(TeamEmployeeScope.class);
        Employee mate = new Employee();
        mate.setId(teammate);
        when(teamScope.resolve(any(), isNull())).thenReturn(List.of(mate));
        TenantModuleLookup modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), anyString())).thenReturn(true);
        service = new GlobalSearchService(queries, employees, teamScope, modules, mock(PlatformTransactionManager.class));
    }

    private void search(Set<String> perms, UUID employeeId) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString());
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        Jwt j = b.build();
        service.search("requests", 5, j, new TestingAuthenticationToken(j, null, perms.toArray(String[]::new)), tenant);
    }

    @Test
    void anEmployeeSearchesOnlyTheirOwnRows() {
        search(SELF, me);
        Scope own = Scope.only(List.of(me));
        verify(queries).wfh(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).shiftChanges(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).corrections(eq(tenant), eq(own), anyList(), anyInt());
        verify(queries).advances(eq(tenant), eq(own), isNull(), anyList(), anyInt());
        verify(queries).overtimeRequests(eq(tenant), eq(own), anyList(), anyInt());
        verifyNoInteractions(teamScope);
    }

    @Test
    void aManagerSearchesTheirTeamAndThemselves() {
        search(MANAGER, me);
        Scope team = Scope.only(List.of(teammate, me));
        verify(queries).wfh(eq(tenant), eq(team), anyList(), anyInt());
        verify(queries).shiftChanges(eq(tenant), eq(team), anyList(), anyInt());
        verify(queries).corrections(eq(tenant), eq(team), anyList(), anyInt());
        verify(queries).overtimeRequests(eq(tenant), eq(team), anyList(), anyInt());
        // Advances: routed to me, plus my own (I may ask for one).
        verify(queries).advances(eq(tenant), eq(Scope.only(List.of(me))), eq(me), anyList(), anyInt());
        verify(queries, never()).wfh(any(), eq(Scope.EVERYONE), anyList(), anyInt());
        verify(queries, never()).advances(any(), eq(Scope.EVERYONE), any(), anyList(), anyInt());
    }

    @Test
    void anApproverWhoMayNotAskForAnAdvanceSeesOnlyThoseRoutedToThem() {
        search(Set.of("hrms.advance.approve"), me);
        verify(queries).advances(eq(tenant), eq(Scope.only(List.of())), eq(me), anyList(), anyInt());
    }

    @Test
    void hrSearchesEveryoneWhereTheirListIsTenantWide() {
        search(HR, me);
        verify(queries).wfh(eq(tenant), eq(Scope.EVERYONE), anyList(), anyInt());
        verify(queries).shiftChanges(eq(tenant), eq(Scope.EVERYONE), anyList(), anyInt());
        verify(queries).advances(eq(tenant), eq(Scope.EVERYONE), isNull(), anyList(), anyInt());
        verify(queries).corrections(eq(tenant), eq(Scope.only(List.of(teammate, me))), anyList(), anyInt());
    }

    @Test
    void noPermissionNoRequestLookups() {
        search(Set.of(), me);
        verify(queries, never()).wfh(any(), any(), anyList(), anyInt());
        verify(queries, never()).shiftChanges(any(), any(), anyList(), anyInt());
        verify(queries, never()).corrections(any(), any(), anyList(), anyInt());
        verify(queries, never()).advances(any(), any(), any(), anyList(), anyInt());
        verify(queries, never()).overtimeRequests(any(), any(), anyList(), anyInt());
    }

    // ── the SQL: every table fenced by the tenant, the people limited to the scope ──

    private static String sqlOf(JdbcTemplate jdbc) {
        ArgumentCaptor<PreparedStatementCreator> psc = ArgumentCaptor.forClass(PreparedStatementCreator.class);
        verify(jdbc, atLeastOnce()).query(psc.capture(), any(RowMapper.class));
        return ((SqlProvider) psc.getValue()).getSql();
    }

    @Test
    void everyRequestQueryIsFencedByTheTenantAndTheScope() {
        UUID t = UUID.randomUUID();
        Scope team = Scope.only(List.of(me, teammate));
        record Case(String table, java.util.function.Consumer<GlobalSearchQueries> run) {}
        List<Case> cases = List.of(
                new Case("leave_mgmt.wfh_requests", q -> q.wfh(t, team, List.of("ravi"), 5)),
                new Case("attendance.shift_change_requests", q -> q.shiftChanges(t, team, List.of("ravi"), 5)),
                new Case("attendance.regularization_requests", q -> q.corrections(t, team, List.of("ravi"), 5)),
                new Case("advance_mgmt.advance_requests", q -> q.advances(t, team, null, List.of("ravi"), 5)),
                new Case("attendance.overtime_requests", q -> q.overtimeRequests(t, team, List.of("ravi"), 5)));
        for (Case c : cases) {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(true);
            c.run().accept(new GlobalSearchQueries(jdbc));
            String sql = sqlOf(jdbc);
            assertThat(sql).as(c.table()).contains(c.table());
            assertThat(sql).as(c.table()).containsPattern("\\w\\.tenant_id = \\?");                 // the request's own tenant
            assertThat(sql).as(c.table()).contains("e.tenant_id = ");                             // the employee joined in the same tenant
            assertThat(sql).as(c.table()).containsPattern("employee_id IN \\(\\?, \\?\\)");        // only the scope's people
            assertThat(sql).as(c.table()).contains("LIKE ?");                                      // typed words are parameters
        }
    }

    @Test
    void advancesForAnApproverAreThoseRoutedToThemOrTheirOwn() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new GlobalSearchQueries(jdbc).advances(UUID.randomUUID(), Scope.only(List.of(me)), me, List.of(), 5);
        assertThat(sqlOf(jdbc)).contains("(a.approver_id = ? OR a.employee_id IN (?))");
        JdbcTemplate jdbc2 = mock(JdbcTemplate.class);
        new GlobalSearchQueries(jdbc2).advances(UUID.randomUUID(), Scope.only(List.of()), me, List.of(), 5);
        assertThat(sqlOf(jdbc2)).contains("AND (a.approver_id = ?)");
    }

    @Test
    void anEmptyScopeQueriesNothingAndAMissingOvertimeTableIsNotAnError() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        GlobalSearchQueries q = new GlobalSearchQueries(jdbc);
        assertThat(q.wfh(UUID.randomUUID(), Scope.only(List.of()), List.of(), 5)).isEmpty();
        assertThat(q.advances(UUID.randomUUID(), Scope.only(List.of()), null, List.of(), 5)).isEmpty();
        verifyNoInteractions(jdbc);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(false);
        assertThat(q.overtimeRequests(UUID.randomUUID(), Scope.EVERYONE, List.of(), 5)).isEmpty();
        verify(jdbc, never()).query(any(PreparedStatementCreator.class), any(RowMapper.class));
    }

    // ── results: your own opens your page, someone else's opens where it's decided ──

    private GlobalSearchService.Caller caller(Set<String> perms) {
        return new GlobalSearchService.Caller(perms, me, tenant, null);
    }

    @Test
    void yourOwnRequestOpensYourPageOthersOpenTheApproversPage() {
        LocalDate d = LocalDate.of(2026, 9, 24);
        var c = caller(MANAGER);
        SearchHit ownWfh = GlobalSearchService.wfhHit(new GlobalSearchQueries.WfhRow(UUID.randomUUID(), me, "Me", "EMP1", d, d, "PENDING"), c);
        SearchHit otherWfh = GlobalSearchService.wfhHit(new GlobalSearchQueries.WfhRow(UUID.randomUUID(), teammate, "Ravi Kumar", "EMP7", d, d.plusDays(1), "APPROVED"), c);
        assertThat(ownWfh.url()).isEqualTo("/me/wfh");
        assertThat(ownWfh.title()).isEqualTo("Work from home");
        assertThat(ownWfh.badge()).isEqualTo("Pending");
        assertThat(otherWfh.url()).isEqualTo("/hrms/leave?tab=approvals");
        assertThat(otherWfh.title()).isEqualTo("Ravi Kumar · Work from home");
        assertThat(otherWfh.subtitle()).isEqualTo("24 Sep – 25 Sep 2026 · EMP7");

        SearchHit shift = GlobalSearchService.shiftChangeHit(new GlobalSearchQueries.ShiftChangeRow(UUID.randomUUID(), me, "Me", "EMP1", "General", "Night", d, "PENDING"), c);
        assertThat(shift.title()).isEqualTo("Shift change to Night");
        assertThat(shift.subtitle()).isEqualTo("General → Night · from 24 Sep 2026");
        assertThat(shift.url()).isEqualTo("/me/shift-change");
        assertThat(GlobalSearchService.shiftChangeHit(new GlobalSearchQueries.ShiftChangeRow(UUID.randomUUID(), teammate, "Ravi", "EMP7", null, null, null, "REJECTED"), c).url())
                .isEqualTo("/hrms/shifts?tab=requests");

        SearchHit fix = GlobalSearchService.correctionHit(new GlobalSearchQueries.CorrectionRow(UUID.randomUUID(), me, "Me", "EMP1", d, "PENDING"), c);
        assertThat(fix.title()).isEqualTo("Attendance fix · 24 Sep 2026");
        assertThat(fix.url()).isEqualTo("/hrms/attendance?tab=corrections");

        SearchHit adv = GlobalSearchService.advanceHit(new GlobalSearchQueries.AdvanceRow(UUID.randomUUID(), me, "Me", "EMP1", new BigDecimal("125000.00"), 6, "REQUESTED"), c);
        assertThat(adv.title()).isEqualTo("Salary advance · ₹1,25,000");
        assertThat(adv.subtitle()).isEqualTo("6 months");
        assertThat(adv.url()).isEqualTo("/hrms/advances?tab=my");
        assertThat(GlobalSearchService.advanceHit(new GlobalSearchQueries.AdvanceRow(UUID.randomUUID(), teammate, "Ravi", "EMP7", null, 1, "APPROVED"), c).url())
                .isEqualTo("/hrms/advances");

        SearchHit ot = GlobalSearchService.overtimeRequestHit(new GlobalSearchQueries.OvertimeRequestRow(UUID.randomUUID(), me, "Me", "EMP1", d, 80, "PENDING"), c);
        assertThat(ot.title()).isEqualTo("Overtime · 24 Sep 2026");
        assertThat(ot.subtitle()).isEqualTo("1 h 20 m");
        assertThat(ot.url()).isEqualTo("/hrms/shifts?tab=overtime");
        assertThat(GlobalSearchService.overtimeRequestHit(new GlobalSearchQueries.OvertimeRequestRow(UUID.randomUUID(), me, "Me", "EMP1", d, 60, "PENDING"), caller(SELF)).url())
                .isEqualTo("/hrms/shifts?tab=myshift");
    }

    @Test
    void typingRequestsListsTheLatestOfEachKind() {
        SearchText text = SearchText.of("requests");
        for (SearchType t : REQUESTS) assertThat(text.wordsFor(t)).as(t.key).isEmpty();
        assertThat(SearchText.of("wfh ravi").wordsFor(SearchType.WFH)).containsExactly("ravi");
    }
}
