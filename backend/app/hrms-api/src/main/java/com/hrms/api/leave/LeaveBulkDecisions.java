package com.hrms.api.leave;

import com.hrms.api.attendance.ApproverScopeGuard;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.hrms.leave.dto.LeaveApprovalRequest;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.service.LeaveService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;

/**
 * "Approve all" on the leave approvals queue (HRMS redesign, BW-42): the same
 * decision as {@code POST /v1/leave/{id}/decision}, once per request, with a
 * result per request.
 *
 * <p>Each request goes through exactly what the single decision does: the
 * approver's team scope ({@link ApproverScopeGuard}), then
 * {@link LeaveService#approveLeave} with its own checks (not your own leave,
 * still waiting) in its own transaction. So one refused request never undoes
 * the others, and every decision lands in the approval-undo journal.
 *
 * <p><b>Through the proxy.</b> {@code leaveService} is the Spring bean, never
 * {@code this}: the undo journal (P-TEAM's aspect on the decide methods) and
 * the transaction only see calls that come in through the proxy, and a loop
 * inside LeaveService calling its own method would skip both.
 * LeaveBulkDecisionTest proxies the service and checks every decision passed
 * through. This class is deliberately not {@code @Transactional}.
 */
@Component
public class LeaveBulkDecisions {

    private static final Logger log = LoggerFactory.getLogger(LeaveBulkDecisions.class);
    /** Enough for every page of the queue at once; more is refused rather than cut short. */
    public static final int MAX_IDS = 100;

    private final LeaveService leaveService;
    private final ApproverScopeGuard approverScopeGuard;

    public LeaveBulkDecisions(LeaveService leaveService, ApproverScopeGuard approverScopeGuard) {
        this.leaveService = leaveService;
        this.approverScopeGuard = approverScopeGuard;
    }

    /** The outcome for one request: {@code ok} with its new status, or the reason it wasn't decided. */
    public record Result(UUID id, boolean ok, String status, String errorCode, String message) {}

    /** Every result, in the order the ids were sent (repeats dropped), with the totals. */
    public record Outcome(int requested, int decided, int failed, List<Result> results) {}

    public Outcome decide(List<UUID> ids, ApprovalStatus status, String comment, UUID deciderEmployeeId,
                          Jwt jwt, Authentication auth) {
        if (status != ApprovalStatus.APPROVED && status != ApprovalStatus.REJECTED) {
            throw new BusinessRuleException("Approval status must be APPROVED or REJECTED", "INVALID_APPROVAL_STATUS");
        }
        LinkedHashSet<UUID> unique = new LinkedHashSet<>();
        if (ids != null) ids.stream().filter(java.util.Objects::nonNull).forEach(unique::add);
        if (unique.isEmpty()) {
            throw new BusinessRuleException("Choose at least one leave request.", "BULK_DECISION_EMPTY");
        }
        if (unique.size() > MAX_IDS) {
            throw new BusinessRuleException("Decide at most %d requests at a time.".formatted(MAX_IDS), "BULK_DECISION_TOO_MANY");
        }
        LeaveApprovalRequest decision = new LeaveApprovalRequest(status, comment);
        List<Result> results = new ArrayList<>(unique.size());
        int decided = 0;
        for (UUID id : unique) {
            Result r = decideOne(id, decision, deciderEmployeeId, jwt, auth);
            if (r.ok()) decided++;
            results.add(r);
        }
        return new Outcome(unique.size(), decided, unique.size() - decided, results);
    }

    private Result decideOne(UUID id, LeaveApprovalRequest decision, UUID deciderEmployeeId, Jwt jwt, Authentication auth) {
        try {
            approverScopeGuard.assertCanDecideFor(leaveService.requesterOf(id), jwt, auth);
            LeaveRequestResponse done = leaveService.approveLeave(id, deciderEmployeeId, decision);
            return new Result(id, true, done.status() != null ? done.status().name() : decision.status().name(), null, null);
        } catch (HrmsException e) {
            return new Result(id, false, null, e.getErrorCode(), e.getMessage());
        } catch (AccessDeniedException e) {
            return new Result(id, false, null, "ACCESS_DENIED", e.getMessage());
        } catch (OptimisticLockingFailureException e) {
            return new Result(id, false, null, "LEAVE_CHANGED",
                    "Someone else changed this request just now. Refresh and try again.");
        } catch (RuntimeException e) {
            log.warn("Bulk leave decision failed for request {}: {}", id, e.toString());
            return new Result(id, false, null, "DECISION_FAILED", "This request couldn't be decided. Try it on its own.");
        }
    }
}
