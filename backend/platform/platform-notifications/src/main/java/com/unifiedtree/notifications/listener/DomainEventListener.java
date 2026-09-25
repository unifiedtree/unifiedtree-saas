package com.unifiedtree.notifications.listener;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.events.AttendanceStatusChangedEvent;
import com.unifiedtree.notifications.events.CorrectionDecidedEvent;
import com.unifiedtree.notifications.events.CorrectionSubmittedEvent;
import com.unifiedtree.notifications.events.EmployeeWelcomeEvent;
import com.unifiedtree.notifications.events.FaceEnrollmentEvent;
import com.unifiedtree.notifications.events.LeaveDecidedEvent;
import com.unifiedtree.notifications.events.LeaveRequestCancelledEvent;
import com.unifiedtree.notifications.events.LeaveRequestSubmittedEvent;
import com.unifiedtree.notifications.events.ShiftChangeDecidedEvent;
import com.unifiedtree.notifications.events.ShiftChangeSubmittedEvent;
import com.unifiedtree.notifications.events.AdvanceRequestDecidedEvent;
import com.unifiedtree.notifications.events.AdvanceRequestSubmittedEvent;
import com.unifiedtree.notifications.events.ExpenseClaimDecidedEvent;
import com.unifiedtree.notifications.events.ExpenseClaimSubmittedEvent;
import com.unifiedtree.notifications.events.OvertimeDecidedEvent;
import com.unifiedtree.notifications.events.DocumentUploadedEvent;
import com.unifiedtree.notifications.events.DocumentVerifiedEvent;
import com.unifiedtree.notifications.events.DocumentRejectedEvent;
import com.unifiedtree.notifications.events.RetirementDueEvent;
import com.unifiedtree.notifications.events.WfhCancelledEvent;
import com.unifiedtree.notifications.events.WfhDecidedEvent;
import com.unifiedtree.notifications.events.WfhRequestSubmittedEvent;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.service.NotificationLookupService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Fan-out from producer events to notification rows.
 *
 * <p>Listens on {@link TransactionPhase#AFTER_COMMIT} — the row that produced
 * the event is guaranteed to be visible to any reader before we notify. This
 * MUST stay synchronous (no {@code @Async}): the SET LOCAL app.tenant_id GUC
 * used for RLS is scoped to the request thread, and an async handoff would
 * lose it and fail-closed on insert.
 *
 * <p>Producer-side note on Kafka: {@code hrms.kafka.enabled} is false on
 * Railway so the existing {@code LeaveEventConsumer} in
 * {@code platform/hrms-notification} would not fire even if it were loaded,
 * and it is explicitly excluded from {@code CanonicalProfileScan}. This is
 * the one live path.
 *
 * <p>Deep-link routes emitted in {@code data.route} must match a screen the
 * mobile app registers (see {@code app/_layout.tsx}). Approver-facing rows point
 * at the approvals inbox tab ({@code /requests-tab}); employee-facing rows point
 * at where that request type is visible to its owner.
 */
@Component
public class DomainEventListener {

    private static final Logger log = LoggerFactory.getLogger(DomainEventListener.class);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("d MMM yyyy");

    // Deep-link routes (must exist in the mobile router).
    private static final String ROUTE_APPROVALS = "/requests-tab";
    private static final String ROUTE_LEAVE_HISTORY = "/leave-history";
    private static final String ROUTE_MY_WFH = "/wfh-apply";
    private static final String ROUTE_MY_CORRECTIONS = "/my-corrections";

    // Seeded system role ids (V004, tenant_id NULL) — mirror ApproverFallbackResolver
    // so a correction with no reporting manager still reaches a real person.
    private static final UUID HR_MANAGER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID SUPER_ADMIN = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private final AppNotificationService service;
    /**
     * All cross-schema reads go through this bean, NOT a bare JdbcTemplate.
     * At AFTER_COMMIT the thread still holds the just-committed connection,
     * whose SET LOCAL app.tenant_id died with the COMMIT — a direct query there
     * silently returns zero rows against every RLS table. See
     * {@link NotificationLookupService} for the full story.
     */
    private final NotificationLookupService lookup;
    /**
     * Renders each notification from the company's template (or the built-in
     * wording in NotificationEventCatalog) and honours the recipient's
     * notification choices before storing / pushing / emailing it.
     */
    private final NotificationDispatcher dispatcher;

    public DomainEventListener(AppNotificationService service, NotificationLookupService lookup,
                               NotificationDispatcher dispatcher) {
        this.service = service;
        this.lookup = lookup;
        this.dispatcher = dispatcher;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Leave
    // ────────────────────────────────────────────────────────────────────────

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onLeaveSubmitted(LeaveRequestSubmittedEvent e) {
        log.info("Notif listener: LEAVE_SUBMITTED leaveRequest={} employee={} approver={} tenant={}",
                e.leaveRequestId(), e.employeeId(), e.approverId(), e.tenantId());
        try {
            if (e.approverId() == null) {
                log.warn("LeaveRequestSubmittedEvent has null approverId; nothing to notify (leaveRequest={})",
                        e.leaveRequestId());
                return;
            }
            String employeeName = resolveEmployeeName(e.employeeId(), e.tenantId());
            String leaveTypeName = e.leaveTypeName() != null ? e.leaveTypeName() : "leave";
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.LEAVE_SUBMITTED.name());
            data.put("leaveRequestId", e.leaveRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), e.approverId(), "leave.submitted", vars(
                    "employeeName", firstOrElse(employeeName, "An employee"),
                    "leaveType", leaveTypeName,
                    "startDate", fmt(e.startDate()),
                    "endDate", fmt(e.endDate())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish LEAVE_SUBMITTED notification for {}: {}",
                    e.leaveRequestId(), ex.getMessage());
        }
    }

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onLeaveDecided(LeaveDecidedEvent e) {
        try {
            AppNotificationType type = e.approved()
                    ? AppNotificationType.LEAVE_APPROVED
                    : AppNotificationType.LEAVE_REJECTED;
            String leaveTypeName = e.leaveTypeName() != null ? e.leaveTypeName() : "leave";
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("leaveRequestId", e.leaveRequestId().toString());
            data.put("route", ROUTE_LEAVE_HISTORY);
            dispatcher.dispatch(e.tenantId(), e.employeeId(), e.approved() ? "leave.approved" : "leave.rejected", vars(
                    "leaveType", leaveTypeName,
                    "startDate", fmt(e.startDate()),
                    "endDate", fmt(e.endDate()),
                    "reason", blankToEmpty(e.comment()),
                    "reasonText", reasonText(e.comment())), data);
            markSubmissionReadSafely(e.leaveRequestId());
        } catch (Exception ex) {
            log.warn("Failed to publish LEAVE decision notification for {}: {}",
                    e.leaveRequestId(), ex.getMessage());
        }
    }

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onLeaveCancelled(LeaveRequestCancelledEvent e) {
        try {
            if (e.approverId() == null) {
                log.warn("LeaveRequestCancelledEvent has null approverId; nothing to notify (leaveRequest={})",
                        e.leaveRequestId());
                return;
            }
            String employeeName = resolveEmployeeName(e.employeeId(), e.tenantId());
            String leaveTypeName = e.leaveTypeName() != null ? e.leaveTypeName() : "leave";
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.LEAVE_CANCELLED.name());
            data.put("leaveRequestId", e.leaveRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), e.approverId(), "leave.cancelled", vars(
                    "employeeName", firstOrElse(employeeName, "An employee"),
                    "leaveType", leaveTypeName,
                    "startDate", fmt(e.startDate()),
                    "endDate", fmt(e.endDate())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish LEAVE_CANCELLED notification for {}: {}",
                    e.leaveRequestId(), ex.getMessage());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Work From Home
    // ────────────────────────────────────────────────────────────────────────

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onWfhSubmitted(WfhRequestSubmittedEvent e) {
        try {
            if (e.approverId() == null) {
                log.warn("WfhRequestSubmittedEvent has null approverId; nothing to notify (wfh={})",
                        e.wfhRequestId());
                return;
            }
            String employeeName = resolveEmployeeName(e.employeeId(), e.tenantId());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.WFH_SUBMITTED.name());
            data.put("wfhRequestId", e.wfhRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), e.approverId(), "wfh.submitted", vars(
                    "employeeName", firstOrElse(employeeName, "An employee"),
                    "dates", range(e.fromDate(), e.toDate())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish WFH_SUBMITTED notification for {}: {}",
                    e.wfhRequestId(), ex.getMessage());
        }
    }

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onWfhDecided(WfhDecidedEvent e) {
        try {
            AppNotificationType type = e.approved()
                    ? AppNotificationType.WFH_APPROVED
                    : AppNotificationType.WFH_REJECTED;
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("wfhRequestId", e.wfhRequestId().toString());
            data.put("route", ROUTE_MY_WFH);
            dispatcher.dispatch(e.tenantId(), e.employeeId(), e.approved() ? "wfh.approved" : "wfh.rejected", vars(
                    "dates", range(e.fromDate(), e.toDate()),
                    "reason", blankToEmpty(e.comment()),
                    "reasonText", reasonText(e.comment())), data);
            markSubmissionReadSafely(e.wfhRequestId());
        } catch (Exception ex) {
            log.warn("Failed to publish WFH decision notification for {}: {}",
                    e.wfhRequestId(), ex.getMessage());
        }
    }

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onWfhCancelled(WfhCancelledEvent e) {
        try {
            if (e.approverId() == null) return;
            String employeeName = resolveEmployeeName(e.employeeId(), e.tenantId());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.WFH_CANCELLED.name());
            data.put("wfhRequestId", e.wfhRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), e.approverId(), "wfh.cancelled", vars(
                    "employeeName", firstOrElse(employeeName, "An employee"),
                    "dates", range(e.fromDate(), e.toDate())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish WFH_CANCELLED notification for {}: {}",
                    e.wfhRequestId(), ex.getMessage());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Attendance corrections
    // ────────────────────────────────────────────────────────────────────────

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onCorrectionSubmitted(CorrectionSubmittedEvent e) {
        try {
            UUID approverId = resolveCorrectionApprover(e.employeeId(), e.tenantId());
            if (approverId == null) {
                log.warn("No approver resolvable for correction {} (employee={}); skipping notification",
                        e.correctionId(), e.employeeId());
                return;
            }
            String employeeName = resolveEmployeeName(e.employeeId(), e.tenantId());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.CORRECTION_SUBMITTED.name());
            data.put("correctionId", e.correctionId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), approverId, "attendance.correction_submitted", vars(
                    "employeeName", firstOrElse(employeeName, "An employee"),
                    "date", fmt(e.requestedDate())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish CORRECTION_SUBMITTED notification for {}: {}",
                    e.correctionId(), ex.getMessage());
        }
    }

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onCorrectionDecided(CorrectionDecidedEvent e) {
        try {
            AppNotificationType type = e.approved()
                    ? AppNotificationType.CORRECTION_APPROVED
                    : AppNotificationType.CORRECTION_REJECTED;
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("correctionId", e.correctionId().toString());
            data.put("route", ROUTE_MY_CORRECTIONS);
            dispatcher.dispatch(e.tenantId(), e.employeeId(),
                    e.approved() ? "attendance.correction_approved" : "attendance.correction_rejected", vars(
                    "date", fmt(e.requestedDate()),
                    "reason", blankToEmpty(e.comment()),
                    "reasonText", reasonText(e.comment())), data);
            markSubmissionReadSafely(e.correctionId());
        } catch (Exception ex) {
            log.warn("Failed to publish CORRECTION decision notification for {}: {}",
                    e.correctionId(), ex.getMessage());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Shift change
    // ────────────────────────────────────────────────────────────────────────

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onShiftChangeSubmitted(ShiftChangeSubmittedEvent e) {
        try {
            UUID approverId = resolveCorrectionApprover(e.employeeId(), e.tenantId());
            if (approverId == null) {
                log.warn("No approver resolvable for shift-change {} (employee={}); skipping notification",
                        e.requestId(), e.employeeId());
                return;
            }
            String employeeName = resolveEmployeeName(e.employeeId(), e.tenantId());
            String shift = e.requestedShiftName() != null ? e.requestedShiftName() : "a different shift";
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.SHIFT_CHANGE_SUBMITTED.name());
            data.put("shiftChangeRequestId", e.requestId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), approverId, "shift.change_submitted", vars(
                    "employeeName", firstOrElse(employeeName, "An employee"),
                    "shiftName", shift,
                    "fromDate", fmt(e.effectiveDate()),
                    "fromDateText", e.effectiveDate() != null ? " from " + fmt(e.effectiveDate()) : ""), data);
        } catch (Exception ex) {
            log.warn("Failed to publish SHIFT_CHANGE_SUBMITTED notification for {}: {}",
                    e.requestId(), ex.getMessage());
        }
    }

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onShiftChangeDecided(ShiftChangeDecidedEvent e) {
        try {
            AppNotificationType type = e.approved()
                    ? AppNotificationType.SHIFT_CHANGE_APPROVED
                    : AppNotificationType.SHIFT_CHANGE_REJECTED;
            String shift = e.requestedShiftName() != null ? e.requestedShiftName() : "the requested shift";
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("shiftChangeRequestId", e.requestId().toString());
            data.put("route", "/shift-change");
            dispatcher.dispatch(e.tenantId(), e.employeeId(),
                    e.approved() ? "shift.change_approved" : "shift.change_rejected", vars(
                    "shiftName", shift,
                    "fromDate", fmt(e.effectiveDate()),
                    "fromDateText", e.effectiveDate() != null ? " from " + fmt(e.effectiveDate()) : "",
                    "reason", blankToEmpty(e.comment()),
                    "reasonText", reasonText(e.comment())), data);
            markSubmissionReadSafely(e.requestId());
        } catch (Exception ex) {
            log.warn("Failed to publish SHIFT_CHANGE decision notification for {}: {}",
                    e.requestId(), ex.getMessage());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Onboarding
    // ────────────────────────────────────────────────────────────────────────

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onEmployeeWelcome(EmployeeWelcomeEvent e) {
        try {
            if (e.employeeId() == null) return;
            String org = e.tenantName() != null && !e.tenantName().isBlank() ? e.tenantName() : "your team";
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.WELCOME.name());
            data.put("route", "/(tabs)");
            dispatcher.dispatch(e.tenantId(), e.employeeId(), "people.welcome", vars("workspaceName", org), data);
        } catch (Exception ex) {
            log.warn("Failed to publish WELCOME notification for {}: {}",
                    e.employeeId(), ex.getMessage());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Face enrollment
    // ────────────────────────────────────────────────────────────────────────

    // fallbackExecution=true: Spring's default AFTER_COMMIT drops events
    // SILENTLY if it can't detect an active transaction synchronization at
    // publish time — which is exactly what was happening (notif.notifications
    // stayed empty after every leave/WFH apply). With fallback ON, an event
    // published outside a live sync still fires the handler synchronously.
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onFaceEnrollment(FaceEnrollmentEvent e) {
        try {
            AppNotificationType type = e.success()
                    ? AppNotificationType.FACE_ENROLLMENT_COMPLETE
                    : AppNotificationType.FACE_ENROLLMENT_FAILED;
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("route", "/face-enroll");
            dispatcher.dispatch(e.tenantId(), e.employeeId(),
                    e.success() ? "attendance.face_enrolled" : "attendance.face_enrolment_failed", vars(
                    "reason", firstOrElse(e.reason(), "Please ask your manager to reset your face enrolment.")), data);
        } catch (Exception ex) {
            log.warn("Failed to publish FACE notification for {}: {}",
                    e.employeeId(), ex.getMessage());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────────

    private String resolveEmployeeName(UUID employeeId, UUID tenantId) {
        return lookup.employeeName(employeeId, tenantId);
    }

    private static String fmt(LocalDate d) {
        return d == null ? "" : DATE_FMT.format(d);
    }

    /**
     * Auto-mark-read for the "SUBMITTED" alert of a request that just got decided.
     * So the approver's Alerts tab clears itself when they act on a request —
     * they don't need to re-open the Alerts tab to keep it tidy. Best-effort;
     * a failure never blocks the primary decision path.
     */
    private void markSubmissionReadSafely(java.util.UUID requestId) {
        if (requestId == null) return;
        try {
            int n = service.markReadByRequestId(requestId.toString());
            if (n > 0) log.debug("Auto-marked {} submission alert(s) read for request={}", n, requestId);
        } catch (Exception ex) {
            log.debug("Auto-mark-read failed for request={}: {}", requestId, ex.getMessage());
        }
    }

    /** "on 5 Jul 2026" for a single day, or "from 5 Jul 2026 to 7 Jul 2026" for a range. */
    private static String range(LocalDate from, LocalDate to) {
        if (from == null) return "";
        if (to == null || to.equals(from)) return "on " + fmt(from);
        return "from %s to %s".formatted(fmt(from), fmt(to));
    }

    /**
     * Resolve who approves {@code employeeId}'s attendance corrections, mirroring
     * the leave/WFH chain: reporting manager → department head → any active HR
     * manager → any active super admin. Returns null only when the tenant has no
     * resolvable approver at all (the caller then skips the notification).
     *
     * <p>Never returns the submitter themselves — a manager correcting their own
     * attendance falls through to the terminal HR/admin fallback instead of
     * self-notifying.
     */
    private UUID resolveCorrectionApprover(UUID employeeId, UUID tenantId) {
        if (employeeId == null || tenantId == null) return null;
        UUID direct = lookup.directApprover(employeeId, tenantId);
        if (direct != null && !direct.equals(employeeId)) return direct;

        UUID hr = firstEmployeeWithRole(tenantId, HR_MANAGER);
        if (hr != null && !hr.equals(employeeId)) return hr;
        UUID admin = firstEmployeeWithRole(tenantId, SUPER_ADMIN);
        return (admin != null && !admin.equals(employeeId)) ? admin : null;
    }

    private UUID firstEmployeeWithRole(UUID tenantId, UUID roleId) {
        return lookup.firstEmployeeWithRole(tenantId, roleId);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Expense / advance / overtime — approver + requester notifications.
    // Same fallbackExecution=true pattern as leave/WFH so the handler runs
    // even without an active transaction synchronization at publish time.
    // ────────────────────────────────────────────────────────────────────────

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onExpenseSubmitted(ExpenseClaimSubmittedEvent e) {
        if (e.approverId() == null) return;
        try {
            String who = firstOrElse(resolveEmployeeName(e.employeeId(), e.tenantId()), "An employee");
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.EXPENSE_SUBMITTED.name());
            data.put("expenseClaimId", e.claimId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), e.approverId(), "expense.submitted", vars(
                    "employeeName", who,
                    "amount", money(e.currency(), e.amount()),
                    "claimTitle", e.title() != null ? e.title() : "claim"), data);
        } catch (Exception ex) {
            log.warn("Failed to publish EXPENSE_SUBMITTED notification for {}: {}", e.claimId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onExpenseDecided(ExpenseClaimDecidedEvent e) {
        try {
            AppNotificationType type = e.approved() ? AppNotificationType.EXPENSE_APPROVED : AppNotificationType.EXPENSE_REJECTED;
            String what = e.title() != null ? e.title() : "your expense claim";
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("expenseClaimId", e.claimId().toString());
            data.put("route", "/my-claims");
            dispatcher.dispatch(e.tenantId(), e.employeeId(), e.approved() ? "expense.approved" : "expense.rejected", vars(
                    "claimTitle", what,
                    "amount", money(e.currency(), e.amount()),
                    "reason", blankToEmpty(e.comment()),
                    "reasonText", reasonText(e.comment())), data);
            markSubmissionReadSafely(e.claimId());
        } catch (Exception ex) {
            log.warn("Failed to publish EXPENSE decision notification for {}: {}", e.claimId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onAdvanceSubmitted(AdvanceRequestSubmittedEvent e) {
        if (e.approverId() == null) return;
        try {
            String who = firstOrElse(resolveEmployeeName(e.employeeId(), e.tenantId()), "An employee");
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.ADVANCE_SUBMITTED.name());
            data.put("advanceRequestId", e.advanceId().toString());
            data.put("route", ROUTE_APPROVALS);
            dispatcher.dispatch(e.tenantId(), e.approverId(), "advance.submitted", vars(
                    "employeeName", who,
                    "amount", money("INR", e.amount())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish ADVANCE_SUBMITTED notification for {}: {}", e.advanceId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onAdvanceDecided(AdvanceRequestDecidedEvent e) {
        try {
            AppNotificationType type = e.approved() ? AppNotificationType.ADVANCE_APPROVED : AppNotificationType.ADVANCE_REJECTED;
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("advanceRequestId", e.advanceId().toString());
            data.put("route", "/my-advances");
            dispatcher.dispatch(e.tenantId(), e.employeeId(), e.approved() ? "advance.approved" : "advance.rejected", vars(
                    "amount", money("INR", e.amount()),
                    "reason", blankToEmpty(e.comment()),
                    "reasonText", reasonText(e.comment())), data);
            markSubmissionReadSafely(e.advanceId());
        } catch (Exception ex) {
            log.warn("Failed to publish ADVANCE decision notification for {}: {}", e.advanceId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onOvertimeDecided(OvertimeDecidedEvent e) {
        try {
            AppNotificationType type = e.approved() ? AppNotificationType.OVERTIME_APPROVED : AppNotificationType.OVERTIME_REJECTED;
            String hours = "%.1fh".formatted(e.minutes() / 60.0);
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("overtimeId", e.overtimeId().toString());
            data.put("route", "/attendance");
            dispatcher.dispatch(e.tenantId(), e.employeeId(),
                    e.approved() ? "attendance.overtime_approved" : "attendance.overtime_rejected", vars(
                    "hours", hours,
                    "date", fmt(e.onDate()),
                    "reason", blankToEmpty(e.comment()),
                    "reasonText", reasonText(e.comment())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish OVERTIME decision notification for {}: {}", e.overtimeId(), ex.getMessage());
        }
    }

    // ─── Attendance status changed by a reviewer (V143.10) ──────────────────
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onAttendanceStatusChanged(AttendanceStatusChangedEvent e) {
        try {
            String from = statusLabel(e.fromStatus()), to = statusLabel(e.toStatus());
            String by = e.changedBy() != null && !e.changedBy().isBlank() ? " by " + e.changedBy() : "";
            String day = fmt(e.date());
            String body = switch (e.kind() == null ? "SET" : e.kind()) {
                case "FACE_REJECT" -> "Your face punch on %s was rejected%s, so the day now counts as %s.".formatted(day, by, to);
                case "FACE_CONFIRM" -> "Your face punch on %s was confirmed%s. The day counts as %s.".formatted(day, by, to);
                case "EXCUSE" -> e.fromStatus() != null && !e.fromStatus().equals(e.toStatus())
                        ? "Your %s on %s was excused%s. The day now counts as %s.".formatted(from.toLowerCase(), day, by, to)
                        : "Your attendance on %s was reviewed and excused%s. It counts as %s.".formatted(day, by, to);
                case "CLEAR" -> "The manual attendance status for %s was removed%s. The company rules now decide: %s.".formatted(day, by, to);
                default -> e.fromStatus() != null && e.fromStatus().equals(e.toStatus())
                        ? "Your attendance for %s was reviewed%s and set to %s.".formatted(day, by, to)
                        : "Your attendance for %s was changed from %s to %s%s.".formatted(day, from, to, by);
            };
            if (e.reason() != null && !e.reason().isBlank()) body += " Reason: " + e.reason().trim();
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.ATTENDANCE_STATUS_CHANGED.name());
            data.put("date", e.date() != null ? e.date().toString() : null);
            data.put("route", "/attendance-history");
            service.create(e.tenantId(), e.employeeId(), AppNotificationType.ATTENDANCE_STATUS_CHANGED,
                    "Attendance updated", body, data);
        } catch (Exception ex) {
            log.warn("Failed to publish ATTENDANCE_STATUS_CHANGED for employee {} on {}: {}",
                    e.employeeId(), e.date(), ex.getMessage());
        }
    }

    private static String statusLabel(String s) {
        if (s == null) return "not marked";
        return switch (s) {
            case "PRESENT" -> "Present";
            case "LATE" -> "Late";
            case "HALF_DAY" -> "Half day";
            case "ABSENT" -> "Absent";
            case "NOT_MARKED" -> "Not marked";
            case "ON_LEAVE" -> "On leave";
            case "HOLIDAY" -> "Holiday";
            case "WEEKLY_OFF" -> "Weekly off";
            default -> s.charAt(0) + s.substring(1).toLowerCase().replace('_', ' ');
        };
    }

    // ─── Document verification ─────────────────────────────────────────────
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDocumentUploaded(DocumentUploadedEvent e) {
        try {
            UUID hr = firstEmployeeWithRole(e.tenantId(), HR_MANAGER);
            if (hr == null) hr = firstEmployeeWithRole(e.tenantId(), SUPER_ADMIN);
            if (hr == null) return;
            String who = firstOrElse(resolveEmployeeName(e.employeeId(), e.tenantId()), "An employee");
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.DOCUMENT_UPLOADED.name());
            data.put("documentId", e.documentId().toString());
            data.put("employeeId", e.employeeId().toString());
            data.put("route", "/documents/pending");
            dispatcher.dispatch(e.tenantId(), hr, "document.uploaded", vars(
                    "employeeName", who,
                    "documentType", firstOrElse(e.documentTypeName(), "document")), data);
        } catch (Exception ex) {
            log.warn("Failed to publish DOCUMENT_UPLOADED notification for {}: {}", e.documentId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDocumentVerified(DocumentVerifiedEvent e) {
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.DOCUMENT_VERIFIED.name());
            data.put("documentId", e.documentId().toString());
            data.put("route", "/profile");
            dispatcher.dispatch(e.tenantId(), e.employeeId(), "document.verified", vars(
                    "documentType", firstOrElse(e.documentTypeName(), "document")), data);
        } catch (Exception ex) {
            log.warn("Failed to publish DOCUMENT_VERIFIED notification for {}: {}", e.documentId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDocumentRejected(DocumentRejectedEvent e) {
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.DOCUMENT_REJECTED.name());
            data.put("documentId", e.documentId().toString());
            data.put("route", "/profile");
            dispatcher.dispatch(e.tenantId(), e.employeeId(), "document.rejected", vars(
                    "documentType", firstOrElse(e.documentTypeName(), "document"),
                    "reason", blankToEmpty(e.reason()),
                    "reasonText", reasonText(e.reason())), data);
        } catch (Exception ex) {
            log.warn("Failed to publish DOCUMENT_REJECTED notification for {}: {}", e.documentId(), ex.getMessage());
        }
    }

    // ─── Retirement due (daily job, 90 and 30 days before) ──────────────────
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onRetirementDue(RetirementDueEvent e) {
        try {
            String who = firstOrElse(e.employeeName(), "A colleague");
            // Plain ASCII: this text also travels as a push notification.
            String title = e.daysLeft() <= 0
                    ? who + " reaches retirement age today"
                    : "%s retires in %d %s".formatted(who, e.daysLeft(), e.daysLeft() == 1 ? "day" : "days");
            String body = "Reaches the retirement age of %d on %s%s. Plan the handover and the final settlement."
                    .formatted(e.retirementAge(), fmt(e.retirementDate()),
                            e.department() != null && !e.department().isBlank() ? " (" + e.department() + ")" : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.RETIREMENT_DUE.name());
            data.put("employeeId", e.employeeId().toString());
            data.put("retirementDate", e.retirementDate().toString());
            data.put("daysLeft", e.daysLeft());
            // Mobile: the milestones screen lists upcoming retirements. The web
            // bell opens the person's record instead (notificationStore).
            data.put("route", "/milestones");
            for (UUID recipient : e.recipientEmployeeIds()) {
                try {
                    service.create(e.tenantId(), recipient, AppNotificationType.RETIREMENT_DUE, title, body, data);
                } catch (Exception ex) {
                    log.warn("Failed to publish RETIREMENT_DUE to {} for {}: {}", recipient, e.employeeId(), ex.getMessage());
                }
            }
        } catch (Exception ex) {
            log.warn("Failed to publish RETIREMENT_DUE notifications for {}: {}", e.employeeId(), ex.getMessage());
        }
    }

    private static String money(String currency, java.math.BigDecimal amount) {
        String symbol = currency == null || currency.isBlank() || "INR".equalsIgnoreCase(currency) ? "₹"
                : currency + " ";
        return symbol + (amount != null ? amount.stripTrailingZeros().toPlainString() : "0");
    }

    private static String firstOrElse(String v, String fallback) {
        return v != null && !v.isBlank() ? v : fallback;
    }

    /** Placeholder values for a template, from alternating name/value pairs (null values → empty). */
    static Map<String, String> vars(String... nameValuePairs) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i + 1 < nameValuePairs.length; i += 2) {
            m.put(nameValuePairs[i], nameValuePairs[i + 1] == null ? "" : nameValuePairs[i + 1]);
        }
        return m;
    }

    /** " Reason: …" when a reason was given, otherwise nothing (the {{reasonText}} placeholder). */
    static String reasonText(String reason) {
        return reason != null && !reason.isBlank() ? " Reason: " + reason.trim() : "";
    }

    private static String blankToEmpty(String v) {
        return v == null || v.isBlank() ? "" : v.trim();
    }
}
