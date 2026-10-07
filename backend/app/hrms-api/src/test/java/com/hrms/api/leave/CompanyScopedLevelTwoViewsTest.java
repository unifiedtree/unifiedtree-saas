package com.hrms.api.leave;

import com.hrms.api.approvals.InboxAccess;
import com.hrms.api.approvals.InboxQueries;
import com.hrms.api.attendance.ApproverScopeGuard;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.wfh.WfhController;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.dto.WfhRequestResponse;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.LeaveTypeService;
import com.hrms.leave.service.WfhService;
import com.unifiedtree.rbac.company.CompanyAccessService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Company access, part 3 (COMPANY_ACCESS.md "Tenant-wide views"): the HR-level
 * leave and work-from-home queues, the decided list and its counts, the
 * approval stats, the leave calendar and the approvals inbox cover a
 * company-scoped level-two approver's current company only (the selected one,
 * else their home company); for everyone else they stay workspace-wide, and so
 * does what such an approver may decide.
 */
class CompanyScopedLevelTwoViewsTest {

    private final UUID tenant = UUID.randomUUID(), me = UUID.randomUUID(), company = UUID.randomUUID();
    private final Pageable page = Pageable.ofSize(20);
    private final Authentication hr = new TestingAuthenticationToken("hr", null,
            "hrms.leave.approve.l1", "hrms.leave.approve.l2", "wfh.approve");
    private LeaveService leaveService;
    private WfhService wfhService;
    private CompanyAccessService access;
    private LeaveController leave;
    private WfhController wfh;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        leaveService = mock(LeaveService.class);
        wfhService = mock(WfhService.class);
        access = mock(CompanyAccessService.class);
        EmployeeRepository employees = mock(EmployeeRepository.class);
        WorkforceDepartmentRepository departments = mock(WorkforceDepartmentRepository.class);
        ApproverFallbackResolver fallback = mock(ApproverFallbackResolver.class);
        leave = new LeaveController(leaveService, mock(LeaveTypeService.class), employees, departments, fallback);
        wfh = new WfhController(wfhService, employees, departments, fallback);
        PageResponse<LeaveRequestResponse> none = new PageResponse<>(List.of(), 0, 20, 0, 0, true);
        when(leaveService.getAllPending(any(), any())).thenReturn(none);
        when(leaveService.getAllPending(any(), any(), any())).thenReturn(none);
        when(leaveService.getPendingL2Approvals(any(), any())).thenReturn(none);
        when(leaveService.getPendingL2Approvals(any(), any(), any())).thenReturn(none);
        when(leaveService.getAllDecided(any(Pageable.class))).thenReturn(none);
        when(leaveService.getAllDecided(any(), any(), any())).thenReturn(none);
        when(leaveService.getMyLeaves(any(), any())).thenReturn(none);
        when(leaveService.getMyBalances(any(), anyInt())).thenReturn(List.of());
        PageResponse<WfhRequestResponse> noWfh = new PageResponse<>(List.of(), 0, 20, 0, 0, true);
        when(wfhService.getAllPending(any(), any())).thenReturn(noWfh);
        when(wfhService.getAllPending(any(), any(), any())).thenReturn(noWfh);
    }

    @AfterEach void clear() { TenantContext.clear(); }

    private Jwt tokenOf(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).build();
    }

    private void companyScoped() {
        when(access.scopedViewCompanyId()).thenReturn(company);
        ReflectionTestUtils.setField(leave, "companyAccess", access);
        ReflectionTestUtils.setField(wfh, "companyAccess", access);
    }

    // ── the HR-level queues ────────────────────────────────────────────────

    @Test void aCompanyScopedHrApproversQueuesCoverTheirCurrentCompany() {
        companyScoped();
        leave.pendingApprovals(tokenOf(me), hr, page);
        verify(leaveService).getAllPending(me, company, page);
        leave.pendingL2Approvals(tokenOf(me), page);
        verify(leaveService).getPendingL2Approvals(me, company, page);
        wfh.pendingApprovals(tokenOf(me), hr, page);
        verify(wfhService).getAllPending(me, company, page);
        leave.overview(tokenOf(me), hr, 2026);
        verify(leaveService).getAllPending(me, company, Pageable.ofSize(1));
        leave.approvalsHistory(tokenOf(me), hr, page, null, null, null);
        verify(leaveService).getAllDecided(null, company, page);
        verify(leaveService).decidedCounts(null, company);
        // The workspace-wide lists are never read for them.
        verify(leaveService, never()).getAllPending(any(), any(Pageable.class));
        verify(leaveService, never()).getPendingL2Approvals(any(), any(Pageable.class));
        verify(wfhService, never()).getAllPending(any(), any(Pageable.class));
    }

    @Test void everyoneElseKeepsTheWorkspaceWideQueuesAsBefore() {
        when(access.scopedViewCompanyId()).thenReturn(null);   // reaches every company
        ReflectionTestUtils.setField(leave, "companyAccess", access);
        ReflectionTestUtils.setField(wfh, "companyAccess", access);
        leave.pendingApprovals(tokenOf(me), hr, page);
        verify(leaveService).getAllPending(me, page);
        leave.pendingL2Approvals(tokenOf(me), page);
        verify(leaveService).getPendingL2Approvals(me, page);
        wfh.pendingApprovals(tokenOf(me), hr, page);
        verify(wfhService).getAllPending(me, page);
        leave.approvalsHistory(tokenOf(me), hr, page, null, null, null);
        verify(leaveService).getAllDecided(page);
        verify(leaveService).decidedCounts(null);
        verify(leaveService, never()).getAllPending(any(), any(), any());
    }

    @Test void aManagersOwnQueueIsNeverNarrowedByIt() {
        companyScoped();
        Authentication manager = new TestingAuthenticationToken("m", null, "hrms.leave.approve.l1", "wfh.approve");
        when(leaveService.getPendingApprovalsForManager(any(), any())).thenReturn(new PageResponse<>(List.of(), 0, 20, 0, 0, true));
        leave.pendingApprovals(tokenOf(me), manager, page);
        verify(leaveService).getPendingApprovalsForManager(me, page);
        verifyNoInteractions(access);
    }

    // ── stats and the calendar ─────────────────────────────────────────────

    @Test void theStatsAndTheCalendarOfACompanyScopedHrApproverCoverTheirCompany() {
        LeaveInsightsService insights = mock(LeaveInsightsService.class);
        LeaveInsightsController controller = new LeaveInsightsController(insights);
        LocalDate from = LocalDate.of(2026, 10, 1), to = LocalDate.of(2026, 10, 31);

        controller.calendar(from, to, null, tokenOf(me), hr);                 // without the bean: as before
        verify(insights).calendar(me, LeaveInsightsService.Scope.TENANT, from, to, null);

        companyScoped();
        ReflectionTestUtils.setField(controller, "companyAccess", access);
        controller.calendar(from, to, null, tokenOf(me), hr);
        verify(insights).calendar(me, LeaveInsightsService.Scope.TENANT, from, to, null, company);
        controller.stats(7, tokenOf(me), hr);
        verify(insights).approvalStats(eq(me), eq(true), eq(7), any(), eq(company));

        Authentication manager = new TestingAuthenticationToken("m", null, "hrms.leave.approve.l1");
        controller.calendar(from, to, null, tokenOf(me), manager);            // a team view: untouched
        verify(insights).calendar(me, LeaveInsightsService.Scope.TEAM, from, to, null);
    }

    // ── the approvals inbox ────────────────────────────────────────────────

    private static InboxAccess levelTwo(UUID me) {
        return new InboxAccess(me, true, true, false, false, false, true, false, false, false, false);
    }

    private static String sqlOf(JdbcTemplate jdbc, List<Object> argsOut) {
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(sql.capture(), any(RowCallbackHandler.class), args.capture());
        argsOut.addAll(Arrays.asList(args.getValue()));
        return sql.getValue();
    }

    @Test void theInboxsTenantWideSourcesCoverACompanyScopedApproversCompany() {
        for (String source : List.of("leave", "leaveL2", "wfh")) {
            JdbcTemplate jdbc = mock(JdbcTemplate.class);
            InboxQueries queries = new InboxQueries(jdbc);
            ReflectionTestUtils.setField(queries, "companyAccess", access);
            when(access.scopedViewCompanyId()).thenReturn(company);
            run(queries, source);
            List<Object> args = new java.util.ArrayList<>();
            String sql = sqlOf(jdbc, args);
            assertTrue(sql.contains("AND e.company_id = ?"), source + ": " + sql);
            assertEquals(List.of(tenant, me, company), args, source);

            JdbcTemplate everyone = mock(JdbcTemplate.class);
            InboxQueries wide = new InboxQueries(everyone);
            run(wide, source);                                                // without the bean: as before
            List<Object> wideArgs = new java.util.ArrayList<>();
            assertFalse(sqlOf(everyone, wideArgs).contains("company_id = ?"), source);
            assertEquals(List.of(tenant, me), wideArgs, source);
        }
    }

    private void run(InboxQueries q, String source) {
        switch (source) {
            case "leave" -> q.leave(tenant, levelTwo(me));
            case "leaveL2" -> q.leaveL2(tenant, levelTwo(me));
            default -> q.wfh(tenant, levelTwo(me));
        }
    }

    // ── deciding: what the queue shows ─────────────────────────────────────

    @Test void aCompanyScopedHrApproverDecidesOnlyTheirCompanysRequests() {
        ApproverScopeGuard guard = new ApproverScopeGuard(mock(TeamEmployeeScope.class));
        UUID requester = UUID.randomUUID();
        assertDoesNotThrow(() -> guard.assertCanDecideFor(requester, tokenOf(me), hr));  // without the beans: as before

        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ReflectionTestUtils.setField(guard, "companyAccess", access);
        ReflectionTestUtils.setField(guard, "jdbc", jdbc);
        when(access.scopedViewCompanyId()).thenReturn(company);
        when(jdbc.queryForList(contains("FROM hrms.employees"), eq(UUID.class), eq(requester))).thenReturn(List.of(company));
        assertDoesNotThrow(() -> guard.assertCanDecideFor(requester, tokenOf(me), hr));
        when(jdbc.queryForList(contains("FROM hrms.employees"), eq(UUID.class), eq(requester))).thenReturn(List.of(UUID.randomUUID()));
        assertThrows(AccessDeniedException.class, () -> guard.assertCanDecideFor(requester, tokenOf(me), hr));

        when(access.scopedViewCompanyId()).thenReturn(null);                   // reaches every company
        assertDoesNotThrow(() -> guard.assertCanDecideFor(requester, tokenOf(me), hr));
    }
}
