package com.hrms.api.approvals;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hrms.attendance.dto.CorrectionDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.ShiftChangeRequestService;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.expense.dto.ExpenseDecisionRequest;
import com.hrms.expense.service.ExpenseService;
import com.hrms.leave.dto.LeaveApprovalRequest;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.WfhService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.AspectJExpressionPointcut;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The Undo journal recorder: every pointcut still matches exactly one decide
 * method (a renamed or overloaded method would silently stop the recording),
 * and the transactional facade keeps each decision's own outcome.
 */
class DecisionJournalAspectTest {

    // ── the hooks match the real decide methods ─────────────────────────────

    private static final Map<String, Class<?>> TARGETS = Map.of(
            DecisionJournalAspect.LEAVE_DECISION, LeaveService.class,
            DecisionJournalAspect.LEAVE_L1, LeaveService.class,
            DecisionJournalAspect.LEAVE_L2, LeaveService.class,
            DecisionJournalAspect.WFH_DECISION, WfhService.class,
            DecisionJournalAspect.CORRECTION_DECISION, AttendanceService.class,
            DecisionJournalAspect.SHIFT_CHANGE_DECISION, ShiftChangeRequestService.class,
            DecisionJournalAspect.EXPENSE_DECISION, ExpenseService.class);

    @Test void everyPointcutMatchesExactlyOnePublicMethodWithTheArgumentsTheRecorderReads() {
        for (Map.Entry<String, Class<?>> t : TARGETS.entrySet()) {
            AspectJExpressionPointcut pc = new AspectJExpressionPointcut();
            pc.setExpression(t.getKey());
            List<Method> matched = Arrays.stream(t.getValue().getDeclaredMethods())
                    .filter(m -> !m.isSynthetic() && pc.matches(m, t.getValue()))
                    .toList();
            assertEquals(1, matched.size(), t.getKey() + " must match exactly one method, matched " + matched);
            Method m = matched.get(0);
            assertTrue(Modifier.isPublic(m.getModifiers()), t.getKey() + " must be public (proxied)");
            Class<?>[] p = m.getParameterTypes();
            assertTrue(p.length >= 3, t.getKey() + " arguments");
            assertEquals(UUID.class, p[0], t.getKey() + " first argument is the request id");
            assertEquals(UUID.class, p[1], t.getKey() + " second argument is who decides");
        }
    }

    @Test void theDecideMethodsTakeTheDecisionTypesTheRecorderReads() throws Exception {
        assertEquals(LeaveApprovalRequest.class, LeaveService.class.getMethod("approveLeave", UUID.class, UUID.class, LeaveApprovalRequest.class).getParameterTypes()[2]);
        assertNotNull(LeaveService.class.getMethod("approveL1", UUID.class, UUID.class, LeaveApprovalRequest.class));
        assertNotNull(LeaveService.class.getMethod("approveL2", UUID.class, UUID.class, LeaveApprovalRequest.class));
        assertNotNull(WfhService.class.getMethod("decide", UUID.class, UUID.class, ApprovalStatus.class, String.class));
        assertNotNull(AttendanceService.class.getMethod("decideCorrection", UUID.class, UUID.class, CorrectionDecisionRequest.class));
        assertNotNull(ShiftChangeRequestService.class.getMethod("decide", UUID.class, UUID.class, ShiftChangeDecisionRequest.class));
        assertNotNull(ExpenseService.class.getMethod("decide", UUID.class, UUID.class, ExpenseDecisionRequest.class));
    }

    @Test void eachAdviceUsesOneOfThePointcutsAndEveryPointcutHasAnAdvice() {
        Set<String> used = Arrays.stream(DecisionJournalAspect.class.getDeclaredMethods())
                .filter(m -> m.isAnnotationPresent(Around.class))
                .map(m -> m.getAnnotation(Around.class).value())
                .collect(Collectors.toSet());
        assertEquals(TARGETS.keySet(), used);
    }

    // ── reading the decision from the arguments ─────────────────────────────

    @Test void theDecisionIsReadFromEachKindsArguments() {
        UUID r = UUID.randomUUID(), d = UUID.randomUUID();
        var leave = DecisionJournalAspect.decisionOf(DecisionKind.LEAVE, new Object[]{r, d, new LeaveApprovalRequest(ApprovalStatus.APPROVED, "ok")});
        assertEquals(new DecisionJournalAspect.Decision(r, d, "APPROVED", "ok"), leave);
        assertEquals("REJECTED", DecisionJournalAspect.decisionOf(DecisionKind.WFH, new Object[]{r, d, ApprovalStatus.REJECTED, "busy week"}).outcome());
        assertEquals("busy week", DecisionJournalAspect.decisionOf(DecisionKind.WFH, new Object[]{r, d, ApprovalStatus.REJECTED, "busy week"}).note());
        assertEquals("APPROVED", DecisionJournalAspect.decisionOf(DecisionKind.CORRECTION, new Object[]{r, d, new CorrectionDecisionRequest(ApprovalStatus.APPROVED, null)}).outcome());
        assertEquals("REJECTED", DecisionJournalAspect.decisionOf(DecisionKind.SHIFT_CHANGE, new Object[]{r, d, new ShiftChangeDecisionRequest(false, "no")}).outcome());
        assertEquals("APPROVED", DecisionJournalAspect.decisionOf(DecisionKind.EXPENSE, new Object[]{r, d, new ExpenseDecisionRequest(true, null)}).outcome());
        // not a decision: the service refuses these itself, nothing is recorded
        assertNull(DecisionJournalAspect.decisionOf(DecisionKind.LEAVE, new Object[]{r, d, new LeaveApprovalRequest(ApprovalStatus.PENDING, null)}));
        assertNull(DecisionJournalAspect.decisionOf(DecisionKind.EXPENSE, new Object[]{r, d, new ExpenseDecisionRequest(null, null)}));
        assertNull(DecisionJournalAspect.decisionOf(DecisionKind.WFH, new Object[]{r, null, ApprovalStatus.APPROVED, null}));
    }

    // ── the transactional facade ────────────────────────────────────────────

    private final UUID tenant = UUID.randomUUID();
    private final UUID requestId = UUID.randomUUID();
    private final UUID decider = UUID.randomUUID();
    private DecisionJournal journal;
    private DecisionStore store;
    private JdbcTemplate jdbc;
    private PlatformTransactionManager tm;
    private SimpleTransactionStatus status;
    private EntityManager em;
    private DecisionJournalAspect aspect;
    private ProceedingJoinPoint pjp;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(UUID.randomUUID());
        journal = mock(DecisionJournal.class);
        jdbc = mock(JdbcTemplate.class);
        store = spy(new DecisionStore(jdbc, new ObjectMapper()));
        tm = mock(PlatformTransactionManager.class);
        status = new SimpleTransactionStatus();
        when(tm.getTransaction(any())).thenReturn(status);
        em = mock(EntityManager.class);
        aspect = new DecisionJournalAspect(journal, store, jdbc, tm);
        ReflectionTestUtils.setField(aspect, "entityManager", em);
        pjp = mock(ProceedingJoinPoint.class);
        when(pjp.getArgs()).thenReturn(new Object[]{requestId, decider, new LeaveApprovalRequest(ApprovalStatus.APPROVED, "fine")});
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private DecisionStore.Snapshot snap(String status, long version) {
        ObjectNode state = new ObjectMapper().createObjectNode();
        state.putObject("request").put("status", status).put("version", version);
        return new DecisionStore.Snapshot(requestId, UUID.randomUUID(), status, version, state);
    }

    @Test void withoutTheTableTheDecisionRunsAsBeforeAndNothingIsRecorded() throws Throwable {
        when(journal.available()).thenReturn(false);
        when(pjp.proceed()).thenReturn("decided");
        assertEquals("decided", aspect.record(pjp, DecisionKind.LEAVE, "DECISION"));
        verify(journal, never()).insert(any());
        verify(em, never()).flush();
        verify(tm).commit(status);
    }

    @Test void aDecisionIsRecordedWithTheStateBeforeAndAfterInTheSameTransaction() throws Throwable {
        when(journal.available()).thenReturn(true);
        doReturn(snap("PENDING", 3)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        doReturn(snap("APPROVED", 4)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, false);
        doReturn("Casual leave · 28–29 Sep").when(store).summary(eq(DecisionKind.LEAVE), eq(tenant), any());
        when(pjp.proceed()).thenReturn("decided");

        assertEquals("decided", aspect.record(pjp, DecisionKind.LEAVE, "DECISION"));

        var order = inOrder(store, pjp, em, journal, tm);
        order.verify(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        order.verify(pjp).proceed();
        order.verify(em).flush();
        order.verify(store).snapshot(DecisionKind.LEAVE, tenant, requestId, false);
        var captor = org.mockito.ArgumentCaptor.forClass(DecisionJournal.NewEntry.class);
        order.verify(journal).insert(captor.capture());
        order.verify(tm).commit(status);
        DecisionJournal.NewEntry e = captor.getValue();
        assertEquals(DecisionKind.LEAVE, e.kind());
        assertEquals("APPROVED", e.decision());
        assertEquals("APPROVED", e.decidedStatus());
        assertEquals(decider, e.decidedByEmployeeId());
        assertEquals(4L, e.postVersion());
        assertEquals("fine", e.note());
        assertTrue(e.priorState().contains("PENDING"));
        assertTrue(e.postState().contains("APPROVED"));
    }

    @Test void aRefusedDecisionRollsBackAndIsNotRecorded() throws Throwable {
        when(journal.available()).thenReturn(true);
        doReturn(snap("APPROVED", 4)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        BusinessRuleException refused = new BusinessRuleException("not pending", "LEAVE_NOT_PENDING");
        when(pjp.proceed()).thenAnswer(inv -> {
            status.setRollbackOnly(); // what the service's own @Transactional does as a participant
            throw refused;
        });
        BusinessRuleException thrown = assertThrows(BusinessRuleException.class, () -> aspect.record(pjp, DecisionKind.LEAVE, "DECISION"));
        assertSame(refused, thrown);
        verify(tm).rollback(status);
        verify(tm, never()).commit(any());
        verify(journal, never()).insert(any());
    }

    @Test void anExceptionTheServiceCommitsOnPurposeIsCommittedThenRethrown() throws Throwable {
        // ShiftChangeRequestService.decide: an expired request is rejected, then SHIFT_CHANGE_EXPIRED is thrown (noRollbackFor)
        when(pjp.getArgs()).thenReturn(new Object[]{requestId, decider, new ShiftChangeDecisionRequest(true, null)});
        when(journal.available()).thenReturn(true);
        doReturn(snap("PENDING", 0)).when(store).snapshot(DecisionKind.SHIFT_CHANGE, tenant, requestId, true);
        ShiftChangeRequestService.RequestExpiredException expired = new ShiftChangeRequestService.RequestExpiredException("expired");
        when(pjp.proceed()).thenThrow(expired);
        assertSame(expired, assertThrows(ShiftChangeRequestService.RequestExpiredException.class,
                () -> aspect.record(pjp, DecisionKind.SHIFT_CHANGE, "DECISION")));
        verify(tm).commit(status);
        verify(tm, never()).rollback(any());
        verify(journal, never()).insert(any());
    }

    @Test void aJournalFailureNeverStopsTheDecision() throws Throwable {
        when(journal.available()).thenReturn(true);
        doReturn(snap("PENDING", 3)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        doReturn(snap("APPROVED", 4)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, false);
        doReturn("x").when(store).summary(any(), any(), any());
        doThrow(new org.springframework.jdbc.BadSqlGrammarException("insert", "INSERT", new java.sql.SQLException("gone", "42P01")))
                .when(journal).insert(any());
        when(pjp.proceed()).thenReturn("decided");

        assertEquals("decided", aspect.record(pjp, DecisionKind.LEAVE, "DECISION"));
        verify(jdbc).execute("ROLLBACK TO SAVEPOINT approval_journal");
        verify(tm).commit(status);
    }

    @Test void aSnapshotFailureMeansNoUndoButTheDecisionStillRuns() throws Throwable {
        when(journal.available()).thenReturn(true);
        doThrow(new org.springframework.dao.QueryTimeoutException("slow")).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        when(pjp.proceed()).thenReturn("decided");
        assertEquals("decided", aspect.record(pjp, DecisionKind.LEAVE, "DECISION"));
        verify(em, never()).flush();
        verify(journal, never()).insert(any());
        verify(tm).commit(status);
    }

    @Test void aDecisionThatLeftTheStatusAloneIsNotRecorded() throws Throwable {
        when(journal.available()).thenReturn(true);
        doReturn(snap("PENDING", 3)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, true);
        doReturn(snap("PENDING", 3)).when(store).snapshot(DecisionKind.LEAVE, tenant, requestId, false);
        when(pjp.proceed()).thenReturn("same");
        assertEquals("same", aspect.record(pjp, DecisionKind.LEAVE, "DECISION"));
        verify(journal, never()).insert(any());
    }

    @Test void withoutATenantNothingIsWrapped() throws Throwable {
        TenantContext.clear();
        when(pjp.proceed()).thenReturn("job");
        assertEquals("job", aspect.record(pjp, DecisionKind.LEAVE, "DECISION"));
        verifyNoInteractions(tm, journal);
    }
}
