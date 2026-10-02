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

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The Approvals inbox shows each built-in role what that role's own approval
 * lists show, with the same scope, and marks rows it can't decide.
 */
class InboxAccessTest {

    // The built-in roles' approval permissions (rbac.role_permissions, 27 Sep 2026; hrms.timesheet.approve from V143_65).
    private static final String[] OWNER = {"hrms.leave.approve.l1", "hrms.leave.approve.l2", "wfh.approve",
            "attendance.regularization.approve", "hrms.expense.claim.approve", "hrms.expense.reimbursement",
            "attendance.workforce.admin", "attendance.team.read", "hrms.timesheet.approve"};
    private static final String[] HR_MANAGER = {"hrms.leave.approve.l1", "hrms.leave.approve.l2", "wfh.approve",
            "attendance.regularization.approve", "hrms.expense.claim.approve", "attendance.workforce.admin",
            "attendance.team.read", "hrms.timesheet.approve"};
    private static final String[] FINANCE_LEAD = {"wfh.approve", "hrms.expense.reimbursement", "attendance.team.read"};
    private static final String[] DEPT_MANAGER = {"hrms.leave.approve.l1", "wfh.approve", "attendance.regularization.approve",
            "hrms.expense.claim.approve", "attendance.team.read", "hrms.timesheet.approve"};
    // A custom role that may only approve timesheets.
    private static final String[] TIMESHEETS_ONLY = {"hrms.timesheet.approve"};
    private static final String[] EMPLOYEE = {"leave.request.self", "attendance.checkin.self"};

    private static final UUID ME = UUID.randomUUID();

    private static Jwt token(String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", ME.toString()).claim("permissions", List.of(permissions)).build();
    }

    private static Authentication auth(String... permissions) {
        return new TestingAuthenticationToken("u", null, permissions);
    }

    /** What the service derives from a role's permissions (JWT and database agree for a fresh sign-in). */
    private static InboxAccess accessOf(String... permissions) {
        PermissionChecker perm = mock(PermissionChecker.class);
        Set<String> held = Set.of(permissions);
        when(perm.check(anyString())).thenAnswer(inv -> held.contains(inv.getArgument(0, String.class)));
        ApprovalsInboxService service = new ApprovalsInboxService(mock(InboxQueries.class), mock(TeamEmployeeScope.class),
                perm, mock(DecisionUndoService.class), mock(PlatformTransactionManager.class));
        return service.access(token(permissions), auth(permissions));
    }

    @Test void eachRoleGetsTheTabsItsPermissionsOpen() {
        assertEquals(List.of("all", "leave", "attendance", "requests", "expenses"), accessOf(OWNER).tabs());
        assertEquals(List.of("all", "leave", "attendance", "requests", "expenses"), accessOf(HR_MANAGER).tabs());
        assertEquals(List.of("all", "leave", "attendance", "requests", "expenses"), accessOf(DEPT_MANAGER).tabs());
        // Finance: work from home only (reimbursement lists claims to pay, not to decide)
        assertEquals(List.of("all", "requests"), accessOf(FINANCE_LEAD).tabs());
        assertEquals(List.of(), accessOf(EMPLOYEE).tabs());
        assertFalse(accessOf(EMPLOYEE).any());
    }

    @Test void theRequestsTabHoldsWorkFromHomeAndShiftChanges() {
        InboxAccess mgr = accessOf(DEPT_MANAGER);
        assertEquals(List.of(DecisionKind.WFH, DecisionKind.SHIFT_CHANGE), mgr.kinds("requests"));
        assertEquals(List.of(DecisionKind.LEAVE), mgr.kinds("leave"));
        assertEquals(List.of(DecisionKind.CORRECTION), mgr.kinds("attendance"));
        assertEquals(List.of(DecisionKind.EXPENSE), mgr.kinds("expenses"));
        assertEquals(5, mgr.kinds("all").size());
        assertEquals(List.of(DecisionKind.WFH), accessOf(FINANCE_LEAD).kinds("all"));
    }

    @Test void theScopeMarkersComeFromTheSamePermissionsTheListsRead() {
        InboxAccess owner = accessOf(OWNER);
        assertTrue(owner.leaveL2());
        assertTrue(owner.workforceAdmin());
        assertTrue(owner.reimbursement());
        InboxAccess mgr = accessOf(DEPT_MANAGER);
        assertFalse(mgr.leaveL2());
        assertFalse(mgr.workforceAdmin());
        assertFalse(mgr.reimbursement());
        assertTrue(mgr.expenseDecide());
    }

    @Test void aRowTheDecideCheckWouldRefuseComesBackWithCanDecideFalse() {
        UUID inTeam = UUID.randomUUID(), routedButOutside = UUID.randomUUID();
        Set<UUID> team = Set.of(inTeam);
        InboxAccess mgr = accessOf(DEPT_MANAGER);
        assertTrue(mgr.canDecide(DecisionKind.LEAVE, inTeam, null, team));
        // routed to the manager (approver or head) but not in TeamEmployeeScope: ApproverScopeGuard refuses
        assertFalse(mgr.canDecide(DecisionKind.LEAVE, routedButOutside, null, team));
        assertFalse(mgr.canDecide(DecisionKind.WFH, routedButOutside, null, team));
        // leave level 2 lets the whole tenant through
        assertTrue(accessOf(HR_MANAGER).canDecide(DecisionKind.LEAVE, routedButOutside, null, team));
        // expense: the claim's approver, or reimbursement holders
        assertTrue(mgr.canDecide(DecisionKind.EXPENSE, inTeam, ME, team));
        assertFalse(mgr.canDecide(DecisionKind.EXPENSE, inTeam, UUID.randomUUID(), team));
        assertTrue(accessOf(OWNER).canDecide(DecisionKind.EXPENSE, inTeam, UUID.randomUUID(), team));
        // never your own request
        assertFalse(accessOf(OWNER).canDecide(DecisionKind.LEAVE, ME, null, Set.of(ME)));
        // work from home needs a reason to reject, nothing else does
        assertTrue(InboxAccess.rejectNeedsReason(DecisionKind.WFH));
        assertFalse(InboxAccess.rejectNeedsReason(DecisionKind.LEAVE));
    }

    @Test void timesheetWeeksSitUnderRequestsForTheirTeamOnly() {
        assertEquals(List.of("all", "requests"), accessOf(TIMESHEETS_ONLY).tabs());
        assertTrue(accessOf(TIMESHEETS_ONLY).any());
        assertTrue(accessOf(TIMESHEETS_ONLY).timesheetsIn("requests"));
        assertTrue(accessOf(TIMESHEETS_ONLY).timesheetsIn("all"));
        assertFalse(accessOf(TIMESHEETS_ONLY).timesheetsIn("leave"));
        assertEquals(List.of(), accessOf(TIMESHEETS_ONLY).kinds("all"));
        assertFalse(accessOf(FINANCE_LEAD).timesheetsIn("requests"));
        UUID inTeam = UUID.randomUUID();
        InboxAccess mgr = accessOf(DEPT_MANAGER);
        assertTrue(mgr.canDecideTimesheet(inTeam, Set.of(inTeam)));
        assertFalse(mgr.canDecideTimesheet(UUID.randomUUID(), Set.of(inTeam)));
        assertFalse(mgr.canDecideTimesheet(ME, Set.of(ME)));
        assertFalse(accessOf(FINANCE_LEAD).canDecideTimesheet(inTeam, Set.of(inTeam)));
    }

    @Test void timesheetWeeksAreTheTeamsSubmittedOnesAndNothingBeforeTheirTableExists() {
        UUID tenant = UUID.randomUUID();
        UUID member = UUID.randomUUID();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("to_regclass('hrms.timesheet_weeks')"), eq(Boolean.class))).thenReturn(true);
        new InboxQueries(jdbc).timesheets(tenant, accessOf(DEPT_MANAGER), Set.of(member));
        List<Object> args = new java.util.ArrayList<>();
        String sql = sqlOf(jdbc, args);
        assertTrue(sql.contains("w.status = 'SUBMITTED'"));
        assertTrue(sql.contains("w.employee_id <> ?"));
        assertTrue(sql.contains("w.employee_id = ANY(CAST(? AS uuid[]))"));
        assertEquals(List.of(tenant, ME, "{" + member + "}"), args);

        JdbcTemplate missing = mock(JdbcTemplate.class);
        when(missing.queryForObject(anyString(), eq(Boolean.class))).thenReturn(false);
        assertEquals(List.of(), new InboxQueries(missing).timesheets(tenant, accessOf(DEPT_MANAGER), Set.of(member)));
        verify(missing, never()).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));

        JdbcTemplate noTeam = mock(JdbcTemplate.class);
        assertEquals(List.of(), new InboxQueries(noTeam).timesheets(tenant, accessOf(DEPT_MANAGER), Set.of()));
        verifyNoInteractions(noTeam);
    }

    // ── each source uses its own list endpoint's scope ───────────────────────

    private static String sqlOf(JdbcTemplate jdbc, List<Object> argsOut) {
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(sql.capture(), any(RowCallbackHandler.class), args.capture());
        argsOut.addAll(Arrays.asList(args.getValue()));
        return sql.getValue();
    }

    @Test void leaveIsTenantWideForLevelTwoElseRoutedToTheCallerAndNeverTheCallersOwn() {
        UUID tenant = UUID.randomUUID();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new InboxQueries(jdbc).leave(tenant, accessOf(HR_MANAGER));
        List<Object> args = new java.util.ArrayList<>();
        String sql = sqlOf(jdbc, args);
        assertTrue(sql.contains("lr.status = 'PENDING'"));
        assertTrue(sql.contains("lr.employee_id <> ?"));
        assertFalse(sql.contains("reporting_manager_id = ?"));
        assertEquals(List.of(tenant, ME), args);

        JdbcTemplate jdbc2 = mock(JdbcTemplate.class);
        new InboxQueries(jdbc2).leave(tenant, accessOf(DEPT_MANAGER));
        List<Object> args2 = new java.util.ArrayList<>();
        String sql2 = sqlOf(jdbc2, args2);
        // the same broadened match as LeaveRequestRepository.findPendingForManager
        assertTrue(sql2.contains("lr.approver_id = ? OR e.reporting_manager_id = ? OR d.department_head_employee_id = ?"));
        assertEquals(List.of(tenant, ME, ME, ME, ME), args2);
    }

    @Test void workFromHomeFollowsTheLeaveRule() {
        UUID tenant = UUID.randomUUID();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new InboxQueries(jdbc).wfh(tenant, accessOf(FINANCE_LEAD));
        String sql = sqlOf(jdbc, new java.util.ArrayList<>());
        assertTrue(sql.contains("w.approver_id = ? OR e.reporting_manager_id = ? OR d.department_head_employee_id = ?"));
    }

    @Test void fixesAndShiftChangesAreTheTeamsAndShiftChangesAreTheTenantsForWorkforceAdmins() {
        UUID tenant = UUID.randomUUID();
        UUID member = UUID.randomUUID();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new InboxQueries(jdbc).corrections(tenant, accessOf(DEPT_MANAGER), Set.of(member));
        List<Object> args = new java.util.ArrayList<>();
        assertTrue(sqlOf(jdbc, args).contains("rr.employee_id = ANY(CAST(? AS uuid[]))"));
        assertEquals("{" + member + "}", args.get(2));
        // no team: nothing is read
        JdbcTemplate none = mock(JdbcTemplate.class);
        assertEquals(List.of(), new InboxQueries(none).corrections(tenant, accessOf(DEPT_MANAGER), Set.of()));
        verifyNoInteractions(none);

        LocalDate today = LocalDate.of(2026, 9, 27);
        JdbcTemplate shifts = mock(JdbcTemplate.class);
        new InboxQueries(shifts).shiftChanges(tenant, accessOf(OWNER), Set.of(), today);
        String sql = sqlOf(shifts, new java.util.ArrayList<>());
        assertFalse(sql.contains("ANY(CAST"));
        assertTrue(sql.contains("scr.requested_effective_date IS NULL OR scr.requested_effective_date >= ?"));
        JdbcTemplate teamShifts = mock(JdbcTemplate.class);
        new InboxQueries(teamShifts).shiftChanges(tenant, accessOf(DEPT_MANAGER), Set.of(member), today);
        assertTrue(sqlOf(teamShifts, new java.util.ArrayList<>()).contains("scr.employee_id = ANY(CAST(? AS uuid[]))"));
    }

    @Test void expensesAreSubmittedOnlyAndRoutedToTheCallerUnlessTheyPayClaims() {
        UUID tenant = UUID.randomUUID();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new InboxQueries(jdbc).expenses(tenant, accessOf(DEPT_MANAGER));
        List<Object> args = new java.util.ArrayList<>();
        String sql = sqlOf(jdbc, args);
        assertTrue(sql.contains("c.status = 'SUBMITTED'"));
        assertFalse(sql.contains("'APPROVED'"));
        assertTrue(sql.contains("c.approver_id = ?"));
        assertEquals(List.of(tenant, ME, ME), args);
        JdbcTemplate owner = mock(JdbcTemplate.class);
        new InboxQueries(owner).expenses(tenant, accessOf(OWNER));
        assertFalse(sqlOf(owner, new java.util.ArrayList<>()).contains("c.approver_id = ?"));
    }

    // ── the service: tabs, counts, paging ────────────────────────────────────

    @AfterEach void clear() {
        TenantContext.clear();
    }

    @Test void theInboxCountsEveryTabMergesNewestFirstAndPages() {
        UUID tenant = UUID.randomUUID();
        TenantContext.setTenantId(tenant);
        InboxQueries q = mock(InboxQueries.class);
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        Employee ea = new Employee();
        ea.setId(a);
        when(scope.resolve(any(), isNull())).thenReturn(List.of(ea));
        java.time.Instant t0 = java.time.Instant.parse("2026-09-27T05:00:00Z");
        when(q.leave(eq(tenant), any())).thenReturn(List.of(row(DecisionKind.LEAVE, a, t0), row(DecisionKind.LEAVE, b, t0.plusSeconds(60))));
        when(q.wfh(eq(tenant), any())).thenReturn(List.of(row(DecisionKind.WFH, a, t0.plusSeconds(120))));
        when(q.corrections(eq(tenant), any(), any())).thenReturn(List.of());
        when(q.shiftChanges(eq(tenant), any(), any(), any())).thenThrow(new org.springframework.dao.QueryTimeoutException("slow"));
        when(q.expenses(eq(tenant), any())).thenReturn(List.of());
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check(anyString())).thenAnswer(inv -> Arrays.asList(DEPT_MANAGER).contains(inv.getArgument(0, String.class)));
        DecisionUndoService undo = mock(DecisionUndoService.class);
        when(undo.recentOrEmpty(any())).thenReturn(List.of());
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        ApprovalsInboxService service = new ApprovalsInboxService(q, scope, perm, undo, tm);

        ApprovalsInboxService.Inbox all = service.inbox("all", 0, 2, token(DEPT_MANAGER), auth(DEPT_MANAGER));
        assertEquals(2, all.counts().get("leave"));
        assertEquals(1, all.counts().get("requests"));
        assertEquals(3, all.counts().get("all"));
        assertEquals(List.of("SHIFT_CHANGE"), all.unavailable());
        assertEquals(3, all.totalElements());
        assertEquals(2, all.rows().size());
        assertEquals("WFH", all.rows().get(0).kind); // newest first
        assertTrue(all.rows().get(0).rejectNeedsReason);
        // b is outside the manager's team: listed (routed to them) but not decidable
        InboxQueries.Row leaveB = all.rows().get(1);
        assertEquals(b, leaveB.employeeId);
        assertFalse(leaveB.canDecide);

        ApprovalsInboxService.Inbox second = service.inbox("all", 1, 2, token(DEPT_MANAGER), auth(DEPT_MANAGER));
        assertEquals(1, second.rows().size());
        assertTrue(second.rows().get(0).canDecide);

        assertEquals("INBOX_TAB_NOT_ALLOWED", assertThrows(com.hrms.core.exception.HrmsException.class,
                () -> service.inbox("expenses", 0, 20, token(FINANCE_LEAD), auth(FINANCE_LEAD))).getErrorCode());
        assertEquals("INBOX_TAB_INVALID", assertThrows(com.hrms.core.exception.HrmsException.class,
                () -> service.inbox("overtime", 0, 20, token(DEPT_MANAGER), auth(DEPT_MANAGER))).getErrorCode());
    }

    @Test void submittedTimesheetWeeksCountUnderRequestsAndCarryNoUndoKind() {
        UUID tenant = UUID.randomUUID();
        TenantContext.setTenantId(tenant);
        InboxQueries q = mock(InboxQueries.class);
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        UUID a = UUID.randomUUID();
        Employee ea = new Employee();
        ea.setId(a);
        when(scope.resolve(any(), isNull())).thenReturn(List.of(ea));
        java.time.Instant t0 = java.time.Instant.parse("2026-09-28T05:00:00Z");
        InboxQueries.Row week = new InboxQueries.Row(InboxQueries.TIMESHEET, false, UUID.randomUUID(), a, "Name", null, null,
                t0.plusSeconds(300), "Timesheet", LocalDate.of(2026, 9, 21), LocalDate.of(2026, 9, 27), null, null, null, null);
        when(q.timesheets(eq(tenant), any(), any())).thenReturn(List.of(week));
        when(q.leave(eq(tenant), any())).thenReturn(List.of(row(DecisionKind.LEAVE, a, t0)));
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check(anyString())).thenAnswer(inv -> Arrays.asList(DEPT_MANAGER).contains(inv.getArgument(0, String.class)));
        DecisionUndoService undo = mock(DecisionUndoService.class);
        when(undo.recentOrEmpty(any())).thenReturn(List.of());
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        ApprovalsInboxService service = new ApprovalsInboxService(q, scope, perm, undo, tm);

        ApprovalsInboxService.Inbox all = service.inbox("all", 0, 20, token(DEPT_MANAGER), auth(DEPT_MANAGER));
        assertEquals(1, all.counts().get("requests"));
        assertEquals(2, all.counts().get("all"));
        assertEquals("TIMESHEET", all.rows().get(0).kind);
        assertTrue(all.rows().get(0).canDecide);
        assertFalse(all.rows().get(0).rejectNeedsReason);
        ApprovalsInboxService.Inbox requests = service.inbox("requests", 0, 20, token(DEPT_MANAGER), auth(DEPT_MANAGER));
        assertEquals(List.of("TIMESHEET"), requests.rows().stream().map(r -> r.kind).toList());
        assertEquals(0, service.inbox("leave", 0, 20, token(DEPT_MANAGER), auth(DEPT_MANAGER)).rows().stream()
                .filter(r -> "TIMESHEET".equals(r.kind)).count());
        // without the permission the source isn't read at all
        reset(q);
        PermissionChecker finance = mock(PermissionChecker.class);
        when(finance.check(anyString())).thenAnswer(inv -> Arrays.asList(FINANCE_LEAD).contains(inv.getArgument(0, String.class)));
        new ApprovalsInboxService(q, scope, finance, undo, tm).inbox("all", 0, 20, token(FINANCE_LEAD), auth(FINANCE_LEAD));
        verify(q, never()).timesheets(any(), any(), any());
    }

    private static InboxQueries.Row row(DecisionKind kind, UUID employee, java.time.Instant at) {
        return new InboxQueries.Row(kind, UUID.randomUUID(), employee, "Name", null, null, at, kind.name(), null, null,
                null, null, null, null);
    }
}
