package com.hrms.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hrms.api.attendance.ApproverScopeGuard;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Approval Undo for each kind: what is put back (including the leave balance
 * maths), and every refusal: a second Undo, the wrong person, the window
 * over, the table missing, and each kind's downstream check.
 */
class DecisionUndoServiceTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final Instant DECIDED = Instant.parse("2026-09-27T05:00:00Z");

    private final UUID tenant = UUID.randomUUID();
    private final UUID me = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID requestId = UUID.randomUUID();
    private DecisionJournal journal;
    private DecisionStore store;
    private ApproverScopeGuard guard;
    private TeamEmployeeScope teamScope;
    private PermissionChecker perm;
    private AuditService audit;
    private ApplicationEventPublisher events;
    private DecisionUndoService service;
    private Jwt jwt;
    private Authentication auth;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(UUID.randomUUID());
        journal = mock(DecisionJournal.class);
        store = spy(new DecisionStore(mock(JdbcTemplate.class), M));
        guard = mock(ApproverScopeGuard.class);
        teamScope = mock(TeamEmployeeScope.class);
        perm = mock(PermissionChecker.class);
        audit = mock(AuditService.class);
        events = mock(ApplicationEventPublisher.class);
        service = new DecisionUndoService(journal, store, guard, teamScope, perm, audit, events);
        service.setClock(Clock.fixed(DECIDED.plusSeconds(120), ZoneOffset.UTC));
        when(journal.available()).thenReturn(true);
        when(perm.check(anyString())).thenReturn(true);
        jwt = token(me, "hrms.leave.approve.l1");
        auth = mock(Authentication.class);
        doReturn("Priya Rao").when(store).employeeName(tenant, me);
        doReturn("Ravi Kumar").when(store).employeeName(tenant, employee);
        doReturn("leave request for 28 Sep 2026").when(store).requestText(any(), eq(tenant), any());
        doReturn(1).when(store).restoreRequest(any(), eq(tenant), eq(requestId), any());
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private static Jwt token(UUID employeeId, String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).claim("permissions", List.of(permissions)).build();
    }

    private static JsonNode json(String s) {
        try {
            return M.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private DecisionJournal.Entry entry(DecisionKind kind, String decision, String path, String prior, String post,
                                        UUID decider, Instant undoneAt) {
        return new DecisionJournal.Entry(UUID.randomUUID(), kind, requestId, employee, decision,
                json(post).path("request").path("status").asText(), path, decider, DECIDED,
                DECIDED.plus(DecisionJournal.UNDO_WINDOW), prior, post, null, null, null, undoneAt);
    }

    private DecisionStore.Snapshot current(String post) {
        JsonNode state = json(post);
        JsonNode request = state.path("request");
        Long version = request.hasNonNull("version") ? request.get("version").asLong() : null;
        return new DecisionStore.Snapshot(requestId, employee, request.path("status").asText(), version, (ObjectNode) state);
    }

    private void journalHas(DecisionJournal.Entry e) {
        when(journal.latestForUpdate(tenant, e.kind(), requestId)).thenReturn(Optional.of(e));
    }

    private static final String LEAVE_PRIOR = """
            {"request":{"id":"r","status":"PENDING","version":3,"start_date":"2026-10-05","end_date":"2026-10-06"},
             "balance":{"id":"11111111-1111-1111-1111-111111111111","used":2.0,"pending":3.0}}""";
    private static final String LEAVE_APPROVED = """
            {"request":{"id":"r","status":"APPROVED","version":4,"start_date":"2026-10-05","end_date":"2026-10-06"},
             "balance":{"id":"11111111-1111-1111-1111-111111111111","used":4.0,"pending":1.0}}""";
    private static final String LEAVE_REJECTED = """
            {"request":{"id":"r","status":"REJECTED","version":4,"start_date":"2026-10-05","end_date":"2026-10-06"},
             "balance":{"id":"11111111-1111-1111-1111-111111111111","used":2.0,"pending":1.0}}""";

    // ── common refusals ──────────────────────────────────────────────────────

    @Test void withoutTheJournalTableUndoIsNotSwitchedOn() {
        when(journal.available()).thenReturn(false);
        FeatureNotReady e = assertThrows(FeatureNotReady.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertEquals("FEATURE_NOT_READY", e.getErrorCode());
        assertThrows(FeatureNotReady.class, () -> service.recent(jwt));
        assertEquals(List.of(), service.recentOrEmpty(jwt));
    }

    @Test void aRequestWithNoRecordedDecisionIsNotFound() {
        when(journal.latestForUpdate(tenant, DecisionKind.LEAVE, requestId)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth));
    }

    @Test void someoneElseCannotTakeItBackAndNothingChanges() {
        journalHas(entry(DecisionKind.LEAVE, "APPROVED", "DECISION", LEAVE_PRIOR, LEAVE_APPROVED, UUID.randomUUID(), null));
        HrmsException e = assertThrows(HrmsException.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("NOT_YOUR_DECISION", e.getErrorCode());
        verify(store, never()).restoreRequest(any(), any(), any(), any());
        verify(store, never()).adjustLeaveBalance(any(), any(), anyDouble(), anyDouble());
        verify(journal, never()).markUndone(any(), any(), any(), any());
    }

    @Test void aSecondUndoIsRefused() {
        journalHas(entry(DecisionKind.LEAVE, "APPROVED", "DECISION", LEAVE_PRIOR, LEAVE_APPROVED, me, DECIDED.plusSeconds(30)));
        assertEquals("DECISION_ALREADY_UNDONE",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth)).getErrorCode());
        verify(store, never()).restoreRequest(any(), any(), any(), any());
    }

    @Test void afterTenMinutesItCanNoLongerBeTakenBack() {
        journalHas(entry(DecisionKind.LEAVE, "APPROVED", "DECISION", LEAVE_PRIOR, LEAVE_APPROVED, me, null));
        service.setClock(Clock.fixed(DECIDED.plusSeconds(601), ZoneOffset.UTC));
        assertEquals("UNDO_WINDOW_PASSED",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth)).getErrorCode());
        verify(store, never()).restoreRequest(any(), any(), any(), any());
    }

    @Test void theDecideEndpointsScopeCheckStillApplies() {
        journalHas(entry(DecisionKind.WFH, "APPROVED", "DECISION", "{\"request\":{\"status\":\"PENDING\",\"version\":1}}",
                "{\"request\":{\"status\":\"APPROVED\",\"version\":2}}", me, null));
        doThrow(new AccessDeniedException("This request is not from your team.")).when(guard).assertCanDecideFor(employee, jwt, auth);
        assertThrows(AccessDeniedException.class, () -> service.undo(DecisionKind.WFH, requestId, jwt, auth));
        verify(store, never()).restoreRequest(any(), any(), any(), any());
    }

    @Test void aSecondLevelLeaveDecisionNeedsTheSecondLevelPermission() {
        journalHas(entry(DecisionKind.LEAVE, "APPROVED", "L2", LEAVE_PRIOR, LEAVE_APPROVED, me, null));
        when(perm.check(Callers.LEAVE_L2)).thenReturn(false);
        HrmsException e = assertThrows(HrmsException.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
    }

    @Test void aRequestCancelledSinceCannotBeTakenBack() {
        journalHas(entry(DecisionKind.LEAVE, "APPROVED", "DECISION", LEAVE_PRIOR, LEAVE_APPROVED, me, null));
        doReturn(current(LEAVE_APPROVED.replace("\"status\":\"APPROVED\"", "\"status\":\"CANCELLED\"")))
                .when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        assertEquals("DECISION_CHANGED_SINCE",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth)).getErrorCode());
        verify(store, never()).adjustLeaveBalance(any(), any(), anyDouble(), anyDouble());
    }

    // ── leave ────────────────────────────────────────────────────────────────

    @Test void undoingALeaveApprovalRestoresTheRequestAndTheBalanceAndTellsTheEmployee() {
        journalHas(entry(DecisionKind.LEAVE, "APPROVED", "DECISION", LEAVE_PRIOR, LEAVE_APPROVED, me, null));
        doReturn(current(LEAVE_APPROVED)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        doReturn(null).when(store).lockedPayrollMonth(any(), any(), any(), any());
        doReturn(1).when(store).adjustLeaveBalance(any(), any(), anyDouble(), anyDouble());

        DecisionUndoService.UndoResult result = service.undo(DecisionKind.LEAVE, requestId, jwt, auth);

        // used 4 → 2 and pending 1 → 3: the store subtracts the decision's change
        verify(store).adjustLeaveBalance(tenant, UUID.fromString("11111111-1111-1111-1111-111111111111"), 2.0, -2.0);
        ArgumentCaptor<JsonNode> prior = ArgumentCaptor.forClass(JsonNode.class);
        verify(store).restoreRequest(eq(DecisionKind.LEAVE), eq(tenant), eq(requestId), prior.capture());
        assertEquals("PENDING", prior.getValue().path("status").asText());
        verify(journal).markUndone(eq(tenant), any(), eq(me), any());
        assertEquals("PENDING", result.status());
        assertEquals("LEAVE", result.kind());
        assertEquals("Ravi Kumar", result.employeeName());
        ArgumentCaptor<DecisionUndoneEvent> told = ArgumentCaptor.forClass(DecisionUndoneEvent.class);
        verify(events).publishEvent(told.capture());
        assertEquals(employee, told.getValue().employeeId());
        assertEquals("Priya Rao", told.getValue().decidedBy());
        assertEquals("approval", told.getValue().previousDecision());
        verify(audit).record(eq("approvals"), eq("DECISION_UNDONE"), eq("leave"), eq(requestId), contains("took back the approval"));
    }

    @Test void undoingALeaveRejectionPutsTheDaysBackOnPending() {
        journalHas(entry(DecisionKind.LEAVE, "REJECTED", "DECISION", LEAVE_PRIOR, LEAVE_REJECTED, me, null));
        doReturn(current(LEAVE_REJECTED)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        doReturn(null).when(store).lockedPayrollMonth(any(), any(), any(), any());
        doReturn(1).when(store).adjustLeaveBalance(any(), any(), anyDouble(), anyDouble());
        service.undo(DecisionKind.LEAVE, requestId, jwt, auth);
        verify(store).adjustLeaveBalance(tenant, UUID.fromString("11111111-1111-1111-1111-111111111111"), 0.0, -2.0);
        ArgumentCaptor<DecisionUndoneEvent> told = ArgumentCaptor.forClass(DecisionUndoneEvent.class);
        verify(events).publishEvent(told.capture());
        assertEquals("rejection", told.getValue().previousDecision());
    }

    @Test void leaveInALockedPayrollMonthIsRefused() {
        journalHas(entry(DecisionKind.LEAVE, "APPROVED", "DECISION", LEAVE_PRIOR, LEAVE_APPROVED, me, null));
        doReturn(current(LEAVE_APPROVED)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        doReturn("Oct 2026").when(store).lockedPayrollMonth(tenant, employee, LocalDate.of(2026, 10, 5), LocalDate.of(2026, 10, 6));
        assertEquals("UNDO_PAYROLL_LOCKED",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.LEAVE, requestId, jwt, auth)).getErrorCode());
        verify(store, never()).adjustLeaveBalance(any(), any(), anyDouble(), anyDouble());
        verify(store, never()).restoreRequest(any(), any(), any(), any());
    }

    // ── work from home ───────────────────────────────────────────────────────

    private static final String WFH_POST = """
            {"request":{"status":"APPROVED","version":2,"from_date":"2026-09-30","to_date":"2026-10-01"}}""";

    @Test void aUsedWorkFromHomeIsRefusedAndAnUnusedOneIsPutBack() {
        journalHas(entry(DecisionKind.WFH, "APPROVED", "DECISION", "{\"request\":{\"status\":\"PENDING\",\"version\":1}}",
                WFH_POST, me, null));
        doReturn(current(WFH_POST)).when(store).snapshot(DecisionKind.WFH, tenant, requestId, true);
        doReturn(LocalDate.of(2026, 9, 30)).when(store).firstWfhPunch(tenant, employee, LocalDate.of(2026, 9, 30), LocalDate.of(2026, 10, 1));
        assertEquals("UNDO_WFH_USED",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.WFH, requestId, jwt, auth)).getErrorCode());

        doReturn(null).when(store).firstWfhPunch(any(), any(), any(), any());
        assertEquals("PENDING", service.undo(DecisionKind.WFH, requestId, jwt, auth).status());
        verify(guard, atLeastOnce()).assertCanDecideFor(employee, jwt, auth);
    }

    // ── attendance fix ───────────────────────────────────────────────────────

    private static final String FIX_PRIOR_NO_RECORD = """
            {"request":{"status":"PENDING","version":0,"missing_for_date":"2026-09-25","record_id":null},"record":null}""";
    private static final String FIX_PRIOR_WITH_RECORD = """
            {"request":{"status":"PENDING","version":0,"missing_for_date":"2026-09-25","record_id":null},
             "record":{"id":"22222222-2222-2222-2222-222222222222","attendance_date":"2026-09-25","version":5,"check_out_at":null}}""";
    private static final String FIX_POST = """
            {"request":{"status":"APPROVED","version":1,"missing_for_date":"2026-09-25","record_id":"22222222-2222-2222-2222-222222222222"},
             "record":{"id":"22222222-2222-2222-2222-222222222222","attendance_date":"2026-09-25","version":6,"check_out_at":"2026-09-25T13:00:00+00:00"}}""";

    private void fixDecided(String prior) {
        journalHas(entry(DecisionKind.CORRECTION, "APPROVED", "DECISION", prior, FIX_POST, me, null));
        doReturn(current(FIX_POST)).when(store).snapshot(DecisionKind.CORRECTION, tenant, requestId, true);
        doReturn(null).when(store).lockedPayrollMonth(any(), any(), any(), any());
        doReturn(false).when(store).overtimeDecided(any(), any());
    }

    @Test void undoingAFixThatCreatedTheDayRemovesIt() {
        fixDecided(FIX_PRIOR_NO_RECORD);
        doReturn(1).when(store).deleteRecord(any(), any(), any());
        doNothing().when(store).logCorrectionUndone(any(), any(), any(), any());
        service.undo(DecisionKind.CORRECTION, requestId, jwt, auth);
        verify(store).deleteRecord(tenant, UUID.fromString("22222222-2222-2222-2222-222222222222"), LocalDate.of(2026, 9, 25));
        verify(store, never()).restoreRecord(any(), any());
    }

    @Test void undoingAFixOnAnExistingDayPutsItBack() {
        fixDecided(FIX_PRIOR_WITH_RECORD);
        doReturn(1).when(store).restoreRecord(any(), any());
        doNothing().when(store).logCorrectionUndone(any(), any(), any(), any());
        service.undo(DecisionKind.CORRECTION, requestId, jwt, auth);
        ArgumentCaptor<JsonNode> record = ArgumentCaptor.forClass(JsonNode.class);
        verify(store).restoreRecord(eq(tenant), record.capture());
        assertEquals(5, record.getValue().path("version").asInt());
        verify(store, never()).deleteRecord(any(), any(), any());
        verify(store).logCorrectionUndone(eq(tenant), any(), eq(me), contains("undone"));
    }

    @Test void aFixWhoseDayChangedOrHadOvertimeDecidedIsRefused() {
        fixDecided(FIX_PRIOR_WITH_RECORD);
        doReturn(true).when(store).overtimeDecided(tenant, UUID.fromString("22222222-2222-2222-2222-222222222222"));
        assertEquals("UNDO_OVERTIME_DECIDED",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.CORRECTION, requestId, jwt, auth)).getErrorCode());

        doReturn(false).when(store).overtimeDecided(any(), any());
        doReturn(current(FIX_POST.replace("\"version\":6", "\"version\":7")))
                .when(store).snapshot(DecisionKind.CORRECTION, tenant, requestId, true);
        assertEquals("DECISION_CHANGED_SINCE",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.CORRECTION, requestId, jwt, auth)).getErrorCode());
        verify(store, never()).restoreRecord(any(), any());
    }

    @Test void aFixInALockedPayrollMonthIsRefused() {
        fixDecided(FIX_PRIOR_WITH_RECORD);
        doReturn("Sep 2026").when(store).lockedPayrollMonth(tenant, employee, LocalDate.of(2026, 9, 25), null);
        assertEquals("UNDO_PAYROLL_LOCKED",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.CORRECTION, requestId, jwt, auth)).getErrorCode());
    }

    // ── shift change ─────────────────────────────────────────────────────────

    private String shiftPost(LocalDate applied) {
        return """
                {"request":{"status":"APPROVED","applied_effective_date":"%s","requested_effective_date":"%s","updated_at":"x"},
                 "assignments":[{"id":"a1","version":1},{"id":"a2","version":0}]}""".formatted(applied, applied);
    }

    private static final String SHIFT_PRIOR = """
            {"request":{"status":"PENDING","updated_at":"w"},"assignments":[{"id":"a1","version":0}]}""";

    @Test void anApprovedShiftChangeIsPutBackBeforeItStarts() {
        LocalDate tomorrow = DateText.todayIst().plusDays(1);
        String post = shiftPost(tomorrow);
        journalHas(entry(DecisionKind.SHIFT_CHANGE, "APPROVED", "DECISION", SHIFT_PRIOR, post, me, null));
        doReturn(current(post)).when(store).snapshot(DecisionKind.SHIFT_CHANGE, tenant, requestId, true);
        doReturn(false).when(store).otherPendingShiftChange(any(), any(), any());
        doNothing().when(store).restoreAssignments(any(), any(), any());
        Jwt admin = token(me, "attendance.regularization.approve", "attendance.workforce.admin");
        service.undo(DecisionKind.SHIFT_CHANGE, requestId, admin, auth);
        verify(store).restoreAssignments(eq(tenant), argThat(a -> a.size() == 1), argThat(a -> a.size() == 2));
    }

    @Test void aShiftThatStartedOrWasChangedAgainOrHasANewRequestIsRefused() {
        Jwt admin = token(me, "attendance.regularization.approve", "attendance.workforce.admin");
        String started = shiftPost(DateText.todayIst().minusDays(1));
        journalHas(entry(DecisionKind.SHIFT_CHANGE, "APPROVED", "DECISION", SHIFT_PRIOR, started, me, null));
        doReturn(current(started)).when(store).snapshot(DecisionKind.SHIFT_CHANGE, tenant, requestId, true);
        doReturn(false).when(store).otherPendingShiftChange(any(), any(), any());
        assertEquals("UNDO_SHIFT_STARTED",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.SHIFT_CHANGE, requestId, admin, auth)).getErrorCode());

        String later = shiftPost(DateText.todayIst().plusDays(2));
        journalHas(entry(DecisionKind.SHIFT_CHANGE, "APPROVED", "DECISION", SHIFT_PRIOR, later, me, null));
        doReturn(current(later.replace("\"version\":0}]", "\"version\":1}]")))
                .when(store).snapshot(DecisionKind.SHIFT_CHANGE, tenant, requestId, true);
        assertEquals("DECISION_CHANGED_SINCE",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.SHIFT_CHANGE, requestId, admin, auth)).getErrorCode());

        doReturn(current(later)).when(store).snapshot(DecisionKind.SHIFT_CHANGE, tenant, requestId, true);
        doReturn(true).when(store).otherPendingShiftChange(tenant, employee, requestId);
        assertEquals("UNDO_SHIFT_PENDING_EXISTS",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.SHIFT_CHANGE, requestId, admin, auth)).getErrorCode());
        verify(store, never()).restoreAssignments(any(), any(), any());
    }

    @Test void aManagerCanTakeBackOnlyTheirTeamsShiftChanges() {
        LocalDate tomorrow = DateText.todayIst().plusDays(1);
        journalHas(entry(DecisionKind.SHIFT_CHANGE, "APPROVED", "DECISION", SHIFT_PRIOR, shiftPost(tomorrow), me, null));
        Jwt manager = token(me, "attendance.regularization.approve");
        when(teamScope.resolve(manager, null)).thenReturn(List.of());
        HrmsException e = assertThrows(HrmsException.class, () -> service.undo(DecisionKind.SHIFT_CHANGE, requestId, manager, auth));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
    }

    // ── expense ──────────────────────────────────────────────────────────────

    @Test void anExpenseClaimInABatchIsRefusedOtherwiseItIsSubmittedAgain() {
        String post = "{\"request\":{\"status\":\"APPROVED\",\"version\":3,\"approver_id\":\"" + me + "\"}}";
        journalHas(entry(DecisionKind.EXPENSE, "APPROVED", "DECISION",
                "{\"request\":{\"status\":\"SUBMITTED\",\"version\":2,\"approver_id\":\"" + employee + "\"}}", post, me, null));
        doReturn(current(post)).when(store).snapshot(DecisionKind.EXPENSE, tenant, requestId, true);
        doReturn(true).when(store).inReimbursementBatch(tenant, requestId);
        Jwt approver = token(me, "hrms.expense.claim.approve");
        assertEquals("UNDO_REIMBURSEMENT_BATCH",
                assertThrows(HrmsException.class, () -> service.undo(DecisionKind.EXPENSE, requestId, approver, auth)).getErrorCode());

        doReturn(false).when(store).inReimbursementBatch(tenant, requestId);
        assertEquals("SUBMITTED", service.undo(DecisionKind.EXPENSE, requestId, approver, auth).status());
    }

    @Test void anExpenseClaimRoutedToSomeoneElseIsRefused() {
        String post = "{\"request\":{\"status\":\"APPROVED\",\"version\":3,\"approver_id\":\"" + UUID.randomUUID() + "\"}}";
        journalHas(entry(DecisionKind.EXPENSE, "APPROVED", "DECISION", "{\"request\":{\"status\":\"SUBMITTED\",\"version\":2}}",
                post, me, null));
        doReturn(current(post)).when(store).snapshot(DecisionKind.EXPENSE, tenant, requestId, true);
        HrmsException e = assertThrows(HrmsException.class,
                () -> service.undo(DecisionKind.EXPENSE, requestId, token(me, "hrms.expense.claim.approve"), auth));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
    }
}
