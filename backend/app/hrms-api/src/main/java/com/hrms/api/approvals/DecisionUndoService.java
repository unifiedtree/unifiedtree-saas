package com.hrms.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.hrms.api.attendance.ApproverScopeGuard;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Approval Undo (redesign BW-06, team audit §6.3): puts a request back to
 * waiting, exactly as it was before the decision, when the person who decided
 * asks within 10 minutes and nothing downstream has used the decision.
 *
 * <p>One mechanism for the five kinds. Each Undo:
 * <ol>
 *   <li>finds the newest journal row for the request and locks it;</li>
 *   <li>checks the caller decided it, still passes that kind's own decide
 *       check, and is inside the window;</li>
 *   <li>locks the request (and what its decision touched) and checks it is
 *       exactly as the decision left it;</li>
 *   <li>checks nothing downstream used it (payroll locked or paid, a work from
 *       home check-in, overtime decided on the day, the new shift started, a
 *       reimbursement batch);</li>
 *   <li>puts everything back (leave balance, attendance record, shift
 *       assignments, the request), marks the journal row, audits, and tells the
 *       employee after the commit.</li>
 * </ol>
 */
@Service
public class DecisionUndoService {

    private static final Logger log = LoggerFactory.getLogger(DecisionUndoService.class);

    private final DecisionJournal journal;
    private final DecisionStore store;
    private final ApproverScopeGuard approverScopeGuard;
    private final TeamEmployeeScope teamScope;
    private final PermissionChecker perm;
    private final AuditService audit;
    private final ApplicationEventPublisher events;
    private Clock clock = Clock.systemUTC();

    public DecisionUndoService(DecisionJournal journal, DecisionStore store, ApproverScopeGuard approverScopeGuard,
                               TeamEmployeeScope teamScope, PermissionChecker perm, AuditService audit,
                               ApplicationEventPublisher events) {
        this.journal = journal;
        this.store = store;
        this.approverScopeGuard = approverScopeGuard;
        this.teamScope = teamScope;
        this.perm = perm;
        this.audit = audit;
        this.events = events;
    }

    /** For tests: a fixed clock. */
    void setClock(Clock clock) {
        this.clock = clock;
    }

    /** The web's {@code DecisionUndoResult}. */
    public record UndoResult(String kind, UUID requestId, String status, Instant undoneAt, String employeeName) {
    }

    /** The caller's decisions that can still be taken back, newest first. FEATURE_NOT_READY without the journal. */
    @Transactional(readOnly = true)
    public List<DecisionJournal.Recent> recent(Jwt jwt) {
        UUID tenantId = TenantContext.requireTenantId();
        if (!journal.available()) throw new FeatureNotReady();
        return FeatureNotReady.guard(() -> journal.recent(tenantId, Callers.employeeId(jwt), clock.instant()));
    }

    /** The caller's recent decisions, or an empty list while the journal isn't switched on (for the inbox). */
    @Transactional(readOnly = true)
    public List<DecisionJournal.Recent> recentOrEmpty(Jwt jwt) {
        UUID tenantId = TenantContext.requireTenantId();
        if (!journal.available()) return List.of();
        return journal.recent(tenantId, Callers.employeeId(jwt), clock.instant());
    }

    @Transactional
    public UndoResult undo(DecisionKind kind, UUID requestId, Jwt jwt, Authentication auth) {
        UUID tenantId = TenantContext.requireTenantId();
        UUID caller = Callers.employeeId(jwt);
        if (!journal.available()) throw new FeatureNotReady();

        DecisionJournal.Entry e = FeatureNotReady.guard(() -> journal.latestForUpdate(tenantId, kind, requestId))
                .orElseThrow(() -> new ResourceNotFoundException("There is no decision to take back on this request."));

        refuse(UndoRules.notTheDecider(e, caller));
        assertMayDecide(kind, e, jwt, auth);
        refuse(UndoRules.alreadyUndone(e));
        refuse(UndoRules.windowPassed(e, clock.instant()));

        JsonNode prior = store.parse(e.priorState());
        JsonNode post = store.parse(e.postState());
        DecisionStore.Snapshot current = store.snapshot(kind, tenantId, requestId, true);
        refuse(UndoRules.changedSince(kind, post.path("request"), current));
        String employeeName = store.employeeName(tenantId, e.employeeId());

        switch (kind) {
            case LEAVE -> undoLeave(tenantId, e, prior, post);
            case WFH -> undoWfh(tenantId, e, post, employeeName);
            case CORRECTION -> undoCorrection(tenantId, e, prior, post, current, caller);
            case SHIFT_CHANGE -> undoShiftChange(tenantId, e, prior, post, current, employeeName);
            case EXPENSE -> undoExpense(tenantId, e, current, jwt, caller);
        }
        String restoredStatus = DecisionStore.text(prior.path("request"), "status");
        if (store.restoreRequest(kind, tenantId, requestId, prior.path("request")) != 1) {
            throw UndoRules.unprocessable("DECISION_CHANGED_SINCE", "This request no longer exists.");
        }
        journal.markUndone(tenantId, e.id(), caller, TenantContext.getUserId());
        Instant undoneAt = clock.instant();

        String deciderName = Objects.requireNonNullElse(store.employeeName(tenantId, caller), "Your approver");
        String requestText = store.requestText(kind, tenantId, prior.path("request"));
        String previous = "APPROVED".equals(e.decision()) ? "approval" : "rejection";
        try {
            audit.record("approvals", "DECISION_UNDONE", kind.name().toLowerCase(java.util.Locale.ROOT), requestId,
                    deciderName + " took back the " + previous + " of " + Objects.requireNonNullElse(employeeName, "an employee")
                            + "'s " + requestText + ".");
        } catch (Exception ex) {
            log.warn("Audit of an Undo failed (non-fatal): {}", ex.getMessage());
        }
        events.publishEvent(new DecisionUndoneEvent(tenantId, e.employeeId(), kind, requestId, deciderName,
                requestText, previous));
        return new UndoResult(kind.name(), requestId, restoredStatus, undoneAt, employeeName);
    }

    // ── the decide endpoints' own checks ─────────────────────────────────────

    /**
     * The same object check the kind's decide endpoint makes, so Undo can't be
     * used by someone who could no longer make the decision: leave, WFH and
     * fixes go through ApproverScopeGuard (leave level 2 also needs its
     * permission); shift changes through ShiftController's scope; expense
     * claims through the claim's approver.
     */
    private void assertMayDecide(DecisionKind kind, DecisionJournal.Entry e, Jwt jwt, Authentication auth) {
        switch (kind) {
            case LEAVE -> {
                String needed = "L2".equals(e.decisionPath()) ? Callers.LEAVE_L2 : "hrms.leave.approve.l1";
                if (!perm.check(needed)) {
                    throw UndoRules.refusal(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "You no longer have the permission to decide this request.");
                }
                approverScopeGuard.assertCanDecideFor(e.employeeId(), jwt, auth);
            }
            case WFH, CORRECTION -> approverScopeGuard.assertCanDecideFor(e.employeeId(), jwt, auth);
            case SHIFT_CHANGE -> {
                Set<UUID> scope = Callers.shiftApproverScope(teamScope, jwt);
                if (scope != null && !scope.contains(e.employeeId())) {
                    throw UndoRules.refusal(HttpStatus.FORBIDDEN, "NOT_IN_SCOPE", "This shift change request is not from your team.");
                }
            }
            case EXPENSE -> { /* checked against the claim's approver below, once the claim is read */ }
        }
    }

    // ── per kind ─────────────────────────────────────────────────────────────

    private void undoLeave(UUID tenantId, DecisionJournal.Entry e, JsonNode prior, JsonNode post) {
        JsonNode request = prior.path("request");
        refuse(UndoRules.payrollLocked(store.lockedPayrollMonth(tenantId, e.employeeId(),
                DecisionStore.date(request, "start_date"), DecisionStore.date(request, "end_date"))));
        UndoRules.BalanceDelta delta = UndoRules.leaveBalanceDelta(prior.get("balance"), post.get("balance"));
        if (delta != null && !delta.none()) {
            if (store.adjustLeaveBalance(tenantId, UUID.fromString(delta.balanceId()), delta.used(), delta.pending()) != 1) {
                throw UndoRules.unprocessable("DECISION_CHANGED_SINCE",
                        "The leave balance this decision changed no longer exists, so it can't be taken back.");
            }
        }
    }

    private void undoWfh(UUID tenantId, DecisionJournal.Entry e, JsonNode post, String employeeName) {
        if (!"APPROVED".equals(e.decision())) return;
        JsonNode request = post.path("request");
        refuse(UndoRules.wfhUsed(employeeName, store.firstWfhPunch(tenantId, e.employeeId(),
                DecisionStore.date(request, "from_date"), DecisionStore.date(request, "to_date"))));
    }

    private void undoCorrection(UUID tenantId, DecisionJournal.Entry e, JsonNode prior, JsonNode post,
                                DecisionStore.Snapshot current, UUID caller) {
        JsonNode request = prior.path("request");
        refuse(UndoRules.payrollLocked(store.lockedPayrollMonth(tenantId, e.employeeId(),
                DecisionStore.date(request, "missing_for_date"), null)));
        if (!"APPROVED".equals(e.decision())) return;
        JsonNode postRecord = post.path("record");
        JsonNode currentRecord = current.state().path("record");
        UUID recordId = DecisionStore.uuid(postRecord, "id");
        refuse(UndoRules.correctionRecordUsed(postRecord, currentRecord, store.overtimeDecided(tenantId, recordId)));
        JsonNode priorRecord = prior.path("record");
        boolean created = priorRecord.isMissingNode() || priorRecord.isNull()
                || !Objects.equals(DecisionStore.text(priorRecord, "id"), DecisionStore.text(postRecord, "id"));
        if (created) {
            store.deleteRecord(tenantId, recordId, DecisionStore.date(postRecord, "attendance_date"));
            store.logCorrectionUndone(tenantId, postRecord, caller, "Correction approval undone: the record it created was removed.");
        } else {
            store.restoreRecord(tenantId, priorRecord);
            store.logCorrectionUndone(tenantId, priorRecord, caller, "Correction approval undone: the day is back as it was.");
        }
    }

    private void undoShiftChange(UUID tenantId, DecisionJournal.Entry e, JsonNode prior, JsonNode post,
                                 DecisionStore.Snapshot current, String employeeName) {
        JsonNode request = post.path("request");
        LocalDate today = DateText.todayIst();
        LocalDate applied = DecisionStore.date(request, "applied_effective_date");
        refuse(UndoRules.shiftTiming(e.decision(), applied, DecisionStore.date(request, "requested_effective_date"), today,
                "APPROVED".equals(e.decision()) && today.equals(applied) && store.checkedIn(tenantId, e.employeeId(), today),
                store.otherPendingShiftChange(tenantId, e.employeeId(), e.requestId()), employeeName));
        if (!"APPROVED".equals(e.decision())) return;
        refuse(UndoRules.assignmentsChanged(post.path("assignments"), current.state().path("assignments")));
        store.restoreAssignments(tenantId, prior.path("assignments"), post.path("assignments"));
    }

    private void undoExpense(UUID tenantId, DecisionJournal.Entry e, DecisionStore.Snapshot current, Jwt jwt, UUID caller) {
        // ExpenseController.decide's object check: finance / admin (reimbursement) or the claim's approver.
        if (!Callers.hasClaim(jwt, "hrms.expense.reimbursement")
                && !Objects.equals(DecisionStore.uuid(current.request(), "approver_id"), caller)) {
            throw UndoRules.refusal(HttpStatus.FORBIDDEN, "NOT_IN_SCOPE", "This expense claim is not routed to you for approval.");
        }
        refuse(UndoRules.inReimbursementBatch(store.inReimbursementBatch(tenantId, e.requestId())));
    }

    private static void refuse(HrmsException refusal) {
        if (refusal != null) throw refusal;
    }
}
