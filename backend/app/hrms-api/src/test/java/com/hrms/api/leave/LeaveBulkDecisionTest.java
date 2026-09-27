package com.hrms.api.leave;

import com.hrms.api.attendance.ApproverScopeGuard;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.leave.dto.LeaveApprovalRequest;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.service.LeaveService;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * "Approve all" (BW-42). Every decision must reach LeaveService.approveLeave
 * through the Spring proxy, because the approval-undo journal (P-TEAM) is an
 * {@code @Around} aspect on that method: a loop inside LeaveService calling its
 * own method would skip it. Here an aspect with the same pointcut records what
 * it sees, on a real AspectJ proxy of the service.
 */
class LeaveBulkDecisionTest {

    /** Stands in for the undo journal: an around advice on the single-step decision. */
    @Aspect
    static class RecordingJournal {
        final List<UUID> seen = Collections.synchronizedList(new ArrayList<>());

        @Around("execution(* com.hrms.leave.service.LeaveService.approveLeave(..))")
        public Object record(ProceedingJoinPoint pjp) throws Throwable {
            seen.add((UUID) pjp.getArgs()[0]);
            return pjp.proceed();
        }
    }

    private final UUID decider = UUID.randomUUID(), requester = UUID.randomUUID();
    private final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject("u").claim("employee_id", decider.toString()).build();
    private LeaveService target;
    private ApproverScopeGuard guard;
    private RecordingJournal journal;
    private LeaveBulkDecisions bulk;

    @BeforeEach void setUp() {
        target = mock(LeaveService.class);
        guard = mock(ApproverScopeGuard.class);
        when(target.requesterOf(any())).thenReturn(requester);
        when(target.approveLeave(any(), any(), any())).thenAnswer(inv ->
                decided(inv.getArgument(0), ((LeaveApprovalRequest) inv.getArgument(2)).status()));
        journal = new RecordingJournal();
        AspectJProxyFactory factory = new AspectJProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAspect(journal);
        LeaveService proxied = factory.getProxy();
        bulk = new LeaveBulkDecisions(proxied, guard);
    }

    private static LeaveRequestResponse decided(UUID id, ApprovalStatus status) {
        return new LeaveRequestResponse(id, null, null, null, null, null, null, null, null, 1, null, status, null, null, null);
    }

    @Test void everyDecisionPassesThroughTheProxySoTheJournalSeesIt() {
        List<UUID> ids = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        LeaveBulkDecisions.Outcome out = bulk.decide(ids, ApprovalStatus.APPROVED, "Enjoy", decider, jwt, null);
        assertEquals(ids, journal.seen);
        assertEquals(3, out.requested());
        assertEquals(3, out.decided());
        assertEquals(0, out.failed());
        assertEquals(ids, out.results().stream().map(LeaveBulkDecisions.Result::id).toList());
        out.results().forEach(r -> assertEquals("APPROVED", r.status()));
        // The same note and decider for each, as the single decision sends them.
        verify(target, times(3)).approveLeave(any(), eq(decider),
                argThat(a -> a.status() == ApprovalStatus.APPROVED && "Enjoy".equals(a.comment())));
    }

    @Test void theJournalPointcutMatchesTheDecideMethod() throws Exception {
        // If approveLeave is renamed or its signature changes, the journal's pointcut (and this one) stop matching.
        assertNotNull(LeaveService.class.getMethod("approveLeave", UUID.class, UUID.class, LeaveApprovalRequest.class));
        bulk.decide(List.of(UUID.randomUUID()), ApprovalStatus.REJECTED, null, decider, jwt, null);
        assertEquals(1, journal.seen.size());
    }

    @Test void eachRequestIsCheckedAndDecidedOnItsOwnAndFailuresAreReportedPerRow() {
        UUID ok1 = UUID.randomUUID(), notPending = UUID.randomUUID(), notMyTeam = UUID.randomUUID(),
                changed = UUID.randomUUID(), broken = UUID.randomUUID(), ok2 = UUID.randomUUID();
        UUID stranger = UUID.randomUUID();
        when(target.requesterOf(notMyTeam)).thenReturn(stranger);
        doThrow(new AccessDeniedException("This request is not from your team.")).when(guard)
                .assertCanDecideFor(eq(stranger), any(), any());
        doThrow(new BusinessRuleException("Leave request is not in PENDING status, current status: APPROVED", "LEAVE_NOT_PENDING"))
                .when(target).approveLeave(eq(notPending), any(), any());
        doThrow(new OptimisticLockingFailureException("stale")).when(target).approveLeave(eq(changed), any(), any());
        doThrow(new IllegalStateException("boom")).when(target).approveLeave(eq(broken), any(), any());

        LeaveBulkDecisions.Outcome out = bulk.decide(List.of(ok1, notPending, notMyTeam, changed, broken, ok2),
                ApprovalStatus.APPROVED, null, decider, jwt, null);

        assertEquals(6, out.requested());
        assertEquals(2, out.decided());
        assertEquals(4, out.failed());
        List<LeaveBulkDecisions.Result> r = out.results();
        assertTrue(r.get(0).ok());
        assertEquals("LEAVE_NOT_PENDING", r.get(1).errorCode());
        assertEquals("ACCESS_DENIED", r.get(2).errorCode());
        assertEquals("LEAVE_CHANGED", r.get(3).errorCode());
        assertEquals("DECISION_FAILED", r.get(4).errorCode());
        assertTrue(r.get(5).ok(), "a failure doesn't stop the requests after it");
        // Out of scope: never decided at all.
        verify(target, never()).approveLeave(eq(notMyTeam), any(), any());
        assertFalse(journal.seen.contains(notMyTeam));
        // Every request's scope was checked before its decision, as /decision does.
        verify(guard, times(6)).assertCanDecideFor(any(), eq(jwt), any());
    }

    @Test void repeatsAreDecidedOnce() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        LeaveBulkDecisions.Outcome out = bulk.decide(List.of(a, b, a, b, a), ApprovalStatus.REJECTED, "No cover", decider, jwt, null);
        assertEquals(2, out.requested());
        assertEquals(List.of(a, b), journal.seen);
    }

    @Test void onlyApproveOrRejectAndAReasonableNumberAtOnce() {
        for (ApprovalStatus s : List.of(ApprovalStatus.PENDING, ApprovalStatus.PENDING_L2, ApprovalStatus.CANCELLED)) {
            BusinessRuleException e = assertThrows(BusinessRuleException.class,
                    () -> bulk.decide(List.of(UUID.randomUUID()), s, null, decider, jwt, null));
            assertEquals("INVALID_APPROVAL_STATUS", e.getErrorCode());
        }
        assertEquals("BULK_DECISION_EMPTY", assertThrows(BusinessRuleException.class,
                () -> bulk.decide(List.of(), ApprovalStatus.APPROVED, null, decider, jwt, null)).getErrorCode());
        List<UUID> tooMany = IntStream.range(0, LeaveBulkDecisions.MAX_IDS + 1).mapToObj(i -> UUID.randomUUID()).toList();
        assertEquals("BULK_DECISION_TOO_MANY", assertThrows(BusinessRuleException.class,
                () -> bulk.decide(tooMany, ApprovalStatus.APPROVED, null, decider, jwt, null)).getErrorCode());
        assertTrue(journal.seen.isEmpty());
        verifyNoInteractions(guard);
    }

    @Test void eachDecisionHasItsOwnTransactionNotOneForTheBatch() throws Exception {
        assertNull(LeaveBulkDecisions.class.getAnnotation(Transactional.class));
        assertNull(LeaveBulkDecisions.class.getMethod("decide", List.class, ApprovalStatus.class, String.class,
                UUID.class, Jwt.class, org.springframework.security.core.Authentication.class).getAnnotation(Transactional.class));
        assertNotNull(LeaveService.class.getMethod("approveLeave", UUID.class, UUID.class, LeaveApprovalRequest.class)
                .getAnnotation(Transactional.class));
    }

    @Test void theEndpointNeedsTheSamePermissionAsTheSingleDecision() throws Exception {
        String bulkGuard = LeaveController.class.getMethod("bulkDecide", LeaveController.BulkDecisionRequest.class,
                Jwt.class, org.springframework.security.core.Authentication.class).getAnnotation(PreAuthorize.class).value();
        String singleGuard = LeaveController.class.getMethod("decide", UUID.class, LeaveApprovalRequest.class,
                Jwt.class, org.springframework.security.core.Authentication.class).getAnnotation(PreAuthorize.class).value();
        assertEquals("@perm.check('hrms.leave.approve.l1')", bulkGuard);
        assertEquals(singleGuard, bulkGuard);
    }
}
