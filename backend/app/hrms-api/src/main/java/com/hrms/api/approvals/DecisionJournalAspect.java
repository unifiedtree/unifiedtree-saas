package com.hrms.api.approvals;

import com.hrms.attendance.dto.CorrectionDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.expense.dto.ExpenseDecisionRequest;
import com.hrms.leave.dto.LeaveApprovalRequest;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.support.DataAccessUtils;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.orm.jpa.vendor.HibernateJpaDialect;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Records every approve / reject of the five Undo kinds in the journal
 * ({@link DecisionJournal}), whichever path made it: the web pages, the mobile
 * app, the Approvals inbox, or a bulk loop.
 *
 * <p>It wraps the service methods the decide endpoints call, so none of those
 * files changes, and works as a transactional facade around each call:
 * <ol>
 *   <li>open a transaction (or join the caller's);</li>
 *   <li>lock the request row, and what its decision touches, and read how it is
 *       now;</li>
 *   <li>call the existing service method, unchanged, in that same transaction:
 *       every existing guard, validation, event and notification stays;</li>
 *   <li>flush, read the request again, and insert the journal row.</li>
 * </ol>
 * The whole journal part runs inside SQL savepoints: if the journal table is
 * missing (the migration isn't applied yet) or anything in the journal part
 * fails, the decision goes through exactly as it did before, only without an
 * Undo, and a WARN is logged. An error from the decision itself still rolls
 * everything back, and an exception the service commits on purpose (a shift
 * change request that expired is rejected, then SHIFT_CHANGE_EXPIRED is
 * thrown) is committed and then rethrown, as before.
 *
 * <p><b>Proxy rule.</b> Spring AOP only sees calls that go through the bean's
 * proxy. Each decide endpoint calls the injected service bean, so they are all
 * seen. A new caller, such as a bulk decision, must also call the injected
 * bean (never {@code this.approveLeave(...)} inside the service), or its
 * decisions are not recorded. {@code DecisionJournalAspectTest} fails if any
 * pointcut here stops matching exactly one method.
 *
 * <p>Ordered to run outside the services' own {@code @Transactional}
 * interceptor, so the service joins the facade's transaction.
 */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 50)
public class DecisionJournalAspect {

    private static final Logger log = LoggerFactory.getLogger(DecisionJournalAspect.class);

    // The service methods behind the decide endpoints (team audit §6.3):
    //   POST /v1/leave/{id}/decision            → LeaveService.approveLeave
    //   POST /v1/leave/{id}/l1-decision         → LeaveService.approveL1
    //   POST /v1/leave/{id}/l2-decision         → LeaveService.approveL2
    //   POST /v1/wfh/{id}/approve | /reject      → WfhService.decide
    //   POST /v1/attendance/corrections/{id}/decision → AttendanceService.decideCorrection
    //   POST /v1/shifts/change-requests/{id}/decision → ShiftChangeRequestService.decide
    //   POST /v1/expense/claims/{id}/decision    → ExpenseService.decide
    static final String LEAVE_DECISION = "execution(* com.hrms.leave.service.LeaveService.approveLeave(..))";
    static final String LEAVE_L1 = "execution(* com.hrms.leave.service.LeaveService.approveL1(..))";
    static final String LEAVE_L2 = "execution(* com.hrms.leave.service.LeaveService.approveL2(..))";
    static final String WFH_DECISION = "execution(* com.hrms.leave.service.WfhService.decide(..))";
    static final String CORRECTION_DECISION = "execution(* com.hrms.attendance.service.AttendanceService.decideCorrection(..))";
    static final String SHIFT_CHANGE_DECISION = "execution(* com.hrms.attendance.service.ShiftChangeRequestService.decide(..))";
    static final String EXPENSE_DECISION = "execution(* com.hrms.expense.service.ExpenseService.decide(..))";

    private static final HibernateJpaDialect JPA_DIALECT = new HibernateJpaDialect();

    private final DecisionJournal journal;
    private final DecisionStore store;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    @PersistenceContext
    private EntityManager entityManager;

    public DecisionJournalAspect(DecisionJournal journal, DecisionStore store, JdbcTemplate jdbc,
                                 PlatformTransactionManager txManager) {
        this.journal = journal;
        this.store = store;
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
    }

    @Around(LEAVE_DECISION)
    public Object leaveDecision(ProceedingJoinPoint pjp) throws Throwable {
        return record(pjp, DecisionKind.LEAVE, "DECISION");
    }

    @Around(LEAVE_L1)
    public Object leaveL1(ProceedingJoinPoint pjp) throws Throwable {
        return record(pjp, DecisionKind.LEAVE, "L1");
    }

    @Around(LEAVE_L2)
    public Object leaveL2(ProceedingJoinPoint pjp) throws Throwable {
        return record(pjp, DecisionKind.LEAVE, "L2");
    }

    @Around(WFH_DECISION)
    public Object wfh(ProceedingJoinPoint pjp) throws Throwable {
        return record(pjp, DecisionKind.WFH, "DECISION");
    }

    @Around(CORRECTION_DECISION)
    public Object correction(ProceedingJoinPoint pjp) throws Throwable {
        return record(pjp, DecisionKind.CORRECTION, "DECISION");
    }

    @Around(SHIFT_CHANGE_DECISION)
    public Object shiftChange(ProceedingJoinPoint pjp) throws Throwable {
        return record(pjp, DecisionKind.SHIFT_CHANGE, "DECISION");
    }

    @Around(EXPENSE_DECISION)
    public Object expense(ProceedingJoinPoint pjp) throws Throwable {
        return record(pjp, DecisionKind.EXPENSE, "DECISION");
    }

    /** The request, who decides, the outcome and the note, read from a decide method's arguments. */
    record Decision(UUID requestId, UUID deciderId, String outcome, String note) {
    }

    /**
     * Reads the decision from the arguments of the wrapped method; null when
     * it isn't an approve or reject (the service refuses those itself, and
     * nothing is recorded).
     */
    static Decision decisionOf(DecisionKind kind, Object[] args) {
        if (args == null || args.length < 3 || !(args[0] instanceof UUID requestId) || !(args[1] instanceof UUID decider)) {
            return null;
        }
        String outcome = null;
        String note = null;
        switch (kind) {
            case LEAVE -> {
                if (args[2] instanceof LeaveApprovalRequest r) {
                    outcome = outcome(r.status());
                    note = r.comment();
                }
            }
            case WFH -> {
                if (args[2] instanceof ApprovalStatus s) {
                    outcome = outcome(s);
                    note = args.length > 3 && args[3] instanceof String c ? c : null;
                }
            }
            case CORRECTION -> {
                if (args[2] instanceof CorrectionDecisionRequest r) {
                    outcome = outcome(r.status());
                    note = r.comment();
                }
            }
            case SHIFT_CHANGE -> {
                if (args[2] instanceof ShiftChangeDecisionRequest r) {
                    outcome = r.approved() ? "APPROVED" : "REJECTED";
                    note = r.comment();
                }
            }
            case EXPENSE -> {
                if (args[2] instanceof ExpenseDecisionRequest r && r.approved() != null) {
                    outcome = r.approved() ? "APPROVED" : "REJECTED";
                    note = r.comment();
                }
            }
        }
        return outcome == null ? null : new Decision(requestId, decider, outcome, note);
    }

    private static String outcome(ApprovalStatus s) {
        if (s == ApprovalStatus.APPROVED) return "APPROVED";
        if (s == ApprovalStatus.REJECTED) return "REJECTED";
        return null;
    }

    Object record(ProceedingJoinPoint pjp, DecisionKind kind, String path) throws Throwable {
        Decision d = decisionOf(kind, pjp.getArgs());
        UUID tenantId = TenantContext.getTenantId();
        if (d == null || tenantId == null) return pjp.proceed();

        Throwable[] committedFailure = new Throwable[1];
        Object result;
        try {
            result = tx.execute(status -> {
                DecisionStore.Snapshot before = journalStep(kind, d.requestId(), "read the request before the decision",
                        () -> journal.available() ? store.snapshot(kind, tenantId, d.requestId(), true) : null);
                Object out;
                try {
                    out = pjp.proceed();
                } catch (Throwable t) {
                    // The service marked the transaction for rollback (the usual case): roll back and rethrow.
                    if (status.isRollbackOnly()) throw new Rethrow(t);
                    // The service chose to keep its work (noRollbackFor): commit it, then rethrow, as before.
                    committedFailure[0] = t;
                    return null;
                }
                if (before != null) {
                    flush();
                    journalStep(kind, d.requestId(), "write the journal row", () -> {
                        write(tenantId, kind, path, d, before);
                        return null;
                    });
                }
                return out;
            });
        } catch (Rethrow r) {
            throw r.getCause();
        }
        if (committedFailure[0] != null) throw committedFailure[0];
        return result;
    }

    private void write(UUID tenantId, DecisionKind kind, String path, Decision d, DecisionStore.Snapshot before) {
        DecisionStore.Snapshot after = store.snapshot(kind, tenantId, d.requestId(), false);
        if (after == null || Objects.equals(after.status(), before.status())) {
            log.debug("Decision on {} {} left its status at {}; nothing to journal", kind, d.requestId(),
                    before.status());
            return;
        }
        journal.insert(new DecisionJournal.NewEntry(tenantId, kind, d.requestId(), before.employeeId(), d.outcome(),
                after.status(), path, d.deciderId(), TenantContext.getUserId(),
                store.json(before.state()), store.json(after.state()), after.version(), d.note(),
                store.summary(kind, tenantId, after)));
    }

    /**
     * Pushes the service's JPA changes to the database so the journal can read
     * the request as the decision left it. A failure here is the decision's own
     * (it would have happened at commit) and rolls it back; it is translated
     * the way the transaction manager translates a commit failure.
     */
    private void flush() {
        try {
            entityManager.flush();
        } catch (RuntimeException e) {
            throw DataAccessUtils.translateIfNecessary(e, JPA_DIALECT);
        }
    }

    /**
     * Runs one journal step inside a savepoint. When it fails, the savepoint is
     * rolled back (the decision's own work is untouched), a WARN is logged and
     * null is returned: the decision goes on without an Undo.
     */
    private <T> T journalStep(DecisionKind kind, UUID requestId, String what, Supplier<T> work) {
        jdbc.execute("SAVEPOINT approval_journal");
        try {
            T value = work.get();
            jdbc.execute("RELEASE SAVEPOINT approval_journal");
            return value;
        } catch (RuntimeException e) {
            try {
                jdbc.execute("ROLLBACK TO SAVEPOINT approval_journal");
                jdbc.execute("RELEASE SAVEPOINT approval_journal");
            } catch (RuntimeException ignored) {
                // the transaction itself is gone; the decision reports its own error
            }
            log.warn("Approval journal: could not {} for {} {} ({}); the decision goes ahead without Undo",
                    what, kind, requestId, e.toString());
            return null;
        }
    }

    /** Carries a decision's exception out of the transaction callback unchanged. */
    static final class Rethrow extends RuntimeException {
        Rethrow(Throwable cause) {
            super(cause);
        }
    }
}
