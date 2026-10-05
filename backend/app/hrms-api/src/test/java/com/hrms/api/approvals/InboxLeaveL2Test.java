package com.hrms.api.approvals;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Leave a manager approved that now waits for HR (PENDING_L2) shows in the Approvals inbox, as kind LEAVE_L2,
 * for holders of hrms.leave.approve.l2, only when the client asks for it (includeL2), so a client that sends
 * every leave row to the single-step decision keeps today's list.
 */
class InboxLeaveL2Test {

    private static final String[] HR_MANAGER = {"hrms.leave.approve.l1", "hrms.leave.approve.l2", "wfh.approve",
            "attendance.regularization.approve", "hrms.expense.claim.approve", "attendance.workforce.admin",
            "attendance.team.read", "hrms.timesheet.approve"};
    private static final String[] DEPT_MANAGER = {"hrms.leave.approve.l1", "wfh.approve", "attendance.regularization.approve",
            "hrms.expense.claim.approve", "attendance.team.read", "hrms.timesheet.approve"};
    // A custom role that decides work from home and HR-level leave, without first-level leave.
    private static final String[] WFH_AND_L2 = {"wfh.approve", "hrms.leave.approve.l2"};

    private static final UUID ME = UUID.randomUUID();

    @AfterEach void clear() {
        TenantContext.clear();
    }

    private static Jwt token(String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", ME.toString()).claim("permissions", List.of(permissions)).build();
    }

    private static Authentication auth(String... permissions) {
        return new TestingAuthenticationToken("u", null, permissions);
    }

    private static PermissionChecker perms(String... permissions) {
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check(anyString())).thenAnswer(inv -> Arrays.asList(permissions).contains(inv.getArgument(0, String.class)));
        return perm;
    }

    private static InboxAccess accessOf(String... permissions) {
        return new ApprovalsInboxService(mock(InboxQueries.class), mock(TeamEmployeeScope.class), perms(permissions),
                mock(DecisionUndoService.class), mock(PlatformTransactionManager.class)).access(token(permissions), auth(permissions));
    }

    @Test void theSourceReadsEveryRequestWaitingForHrButNeverTheCallersOwn() {
        UUID tenant = UUID.randomUUID();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new InboxQueries(jdbc).leaveL2(tenant, accessOf(HR_MANAGER));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(sql.capture(), any(RowCallbackHandler.class), args.capture());
        assertTrue(sql.getValue().contains("lr.status = 'PENDING_L2'"));
        assertFalse(sql.getValue().contains("lr.status = 'PENDING'"));
        assertTrue(sql.getValue().contains("lr.employee_id <> ?"));
        // the whole tenant, as GET /v1/leave/approvals/pending-l2
        assertFalse(sql.getValue().contains("reporting_manager_id = ?"));
        assertEquals(List.of(tenant, ME), Arrays.asList(args.getValue()));
    }

    @Test void onlyLevelTwoDecidesAndNeverTheirOwnOrOneTheyApprovedAtLevelOne() {
        UUID someone = UUID.randomUUID(), theirManager = UUID.randomUUID();
        InboxAccess hr = accessOf(HR_MANAGER);
        assertTrue(hr.canDecideLeaveL2(someone, theirManager));
        assertTrue(hr.canDecideLeaveL2(someone, null));
        assertFalse(hr.canDecideLeaveL2(ME, theirManager));
        assertFalse(hr.canDecideLeaveL2(someone, ME));
        assertFalse(hr.canDecideLeaveL2(null, theirManager));
        assertFalse(accessOf(DEPT_MANAGER).canDecideLeaveL2(someone, theirManager));
    }

    @Test void theLeaveTabIsThereForLevelTwoWhenAskedFor() {
        assertEquals(List.of("all", "requests"), accessOf(WFH_AND_L2).tabs(false));
        assertEquals(List.of("all", "leave", "requests"), accessOf(WFH_AND_L2).tabs(true));
        assertEquals(accessOf(HR_MANAGER).tabs(), accessOf(HR_MANAGER).tabs(true));
        assertEquals(accessOf(DEPT_MANAGER).tabs(), accessOf(DEPT_MANAGER).tabs(true));
        assertTrue(accessOf(HR_MANAGER).leaveL2In(true, "all"));
        assertTrue(accessOf(HR_MANAGER).leaveL2In(true, "leave"));
        assertFalse(accessOf(HR_MANAGER).leaveL2In(true, "requests"));
        assertFalse(accessOf(HR_MANAGER).leaveL2In(false, "leave"));
        assertFalse(accessOf(DEPT_MANAGER).leaveL2In(true, "leave"));
    }

    private record Setup(ApprovalsInboxService service, InboxQueries queries) {}

    private static Setup setup(UUID tenant, List<InboxQueries.Row> l2Rows, String... permissions) {
        TenantContext.setTenantId(tenant);
        InboxQueries q = mock(InboxQueries.class);
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        Employee member = new Employee();
        member.setId(UUID.randomUUID());
        when(scope.resolve(any(), isNull())).thenReturn(List.of(member));
        when(q.leaveL2(eq(tenant), any())).thenReturn(l2Rows);
        DecisionUndoService undo = mock(DecisionUndoService.class);
        when(undo.recentOrEmpty(any())).thenReturn(List.of());
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        return new Setup(new ApprovalsInboxService(q, scope, perms(permissions), undo, tm), q);
    }

    private static InboxQueries.Row l2Row(UUID employee, UUID firstLevelApprover, Instant at) {
        InboxQueries.Row r = new InboxQueries.Row(InboxQueries.LEAVE_L2, false, UUID.randomUUID(), employee, "Asha Rao", null,
                null, at, "Casual leave", LocalDate.of(2026, 10, 12), LocalDate.of(2026, 10, 13), 2.0, null, null, null);
        r.extra.put("approverId", firstLevelApprover);
        return r;
    }

    @Test void askedForTheyCountUnderLeaveAndCanBeDecidedWhenTheCallerDidNotApproveThemAtLevelOne() {
        UUID tenant = UUID.randomUUID();
        Instant t0 = Instant.parse("2026-10-06T05:00:00Z");
        InboxQueries.Row fromSomeoneElse = l2Row(UUID.randomUUID(), UUID.randomUUID(), t0);
        InboxQueries.Row approvedByMe = l2Row(UUID.randomUUID(), ME, t0.plusSeconds(60));
        Setup s = setup(tenant, List.of(fromSomeoneElse, approvedByMe), HR_MANAGER);

        ApprovalsInboxService.Inbox all = s.service().inbox("all", 0, 20, true, token(HR_MANAGER), auth(HR_MANAGER));
        assertEquals(2, all.counts().get("leave"));
        assertEquals(2, all.counts().get("all"));
        assertEquals(List.of("LEAVE_L2", "LEAVE_L2"), all.rows().stream().map(r -> r.kind).toList());
        assertEquals(approvedByMe.requestId, all.rows().get(0).requestId); // newest first
        assertFalse(all.rows().get(0).canDecide);
        assertTrue(all.rows().get(1).canDecide);
        assertFalse(all.rows().get(1).rejectNeedsReason);
        // they get the leave facts (balance after, others out) like any leave request
        verify(s.queries()).enrichLeave(eq(tenant), argThat(list -> list.size() == 2), isNull());

        ApprovalsInboxService.Inbox leave = s.service().inbox("leave", 0, 20, true, token(HR_MANAGER), auth(HR_MANAGER));
        assertEquals(2, leave.rows().size());
        ApprovalsInboxService.Inbox requests = s.service().inbox("requests", 0, 20, true, token(HR_MANAGER), auth(HR_MANAGER));
        assertTrue(requests.rows().stream().noneMatch(r -> "LEAVE_L2".equals(r.kind)));
    }

    @Test void notAskedForOrWithoutLevelTwoTheListIsTodays() {
        UUID tenant = UUID.randomUUID();
        Setup s = setup(tenant, List.of(l2Row(UUID.randomUUID(), null, Instant.now())), HR_MANAGER);
        ApprovalsInboxService.Inbox plain = s.service().inbox("all", 0, 20, token(HR_MANAGER), auth(HR_MANAGER));
        assertEquals(0, plain.counts().get("all"));
        assertTrue(plain.rows().isEmpty());
        verify(s.queries(), never()).leaveL2(any(), any());

        Setup m = setup(tenant, List.of(l2Row(UUID.randomUUID(), null, Instant.now())), DEPT_MANAGER);
        ApprovalsInboxService.Inbox mgr = m.service().inbox("all", 0, 20, true, token(DEPT_MANAGER), auth(DEPT_MANAGER));
        assertTrue(mgr.rows().isEmpty());
        verify(m.queries(), never()).leaveL2(any(), any());
    }

    @Test void aFailingSourceIsReportedAndTheRestStillLoads() {
        UUID tenant = UUID.randomUUID();
        Setup s = setup(tenant, List.of(), HR_MANAGER);
        when(s.queries().leaveL2(eq(tenant), any())).thenThrow(new org.springframework.dao.QueryTimeoutException("slow"));
        ApprovalsInboxService.Inbox all = s.service().inbox("all", 0, 20, true, token(HR_MANAGER), auth(HR_MANAGER));
        assertEquals(List.of("LEAVE_L2"), all.unavailable());
        assertEquals(new ArrayList<>(List.of("all", "leave", "attendance", "requests", "expenses")), all.tabs());
    }
}
