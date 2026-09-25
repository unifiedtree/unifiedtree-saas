package com.unifiedtree.notifications.listener;

import com.unifiedtree.notifications.enums.AppNotificationType;
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

    public DomainEventListener(AppNotificationService service, NotificationLookupService lookup) {
        this.service = service;
        this.lookup = lookup;
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
            String body = "%s requested %s from %s to %s".formatted(
                    employeeName != null ? employeeName : "An employee",
                    leaveTypeName,
                    fmt(e.startDate()),
                    fmt(e.endDate()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.LEAVE_SUBMITTED.name());
            data.put("leaveRequestId", e.leaveRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), e.approverId(),
                    AppNotificationType.LEAVE_SUBMITTED,
                    "New leave request",
                    body,
                    data);
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
            String title = e.approved() ? "Leave approved" : "Leave rejected";
            String leaveTypeName = e.leaveTypeName() != null ? e.leaveTypeName() : "leave";
            String body = e.approved()
                    ? "Your %s from %s to %s has been approved.".formatted(
                            leaveTypeName, fmt(e.startDate()), fmt(e.endDate()))
                    : "Your %s from %s to %s has been rejected.%s".formatted(
                            leaveTypeName, fmt(e.startDate()), fmt(e.endDate()),
                            e.comment() != null && !e.comment().isBlank()
                                    ? " Reason: " + e.comment() : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("leaveRequestId", e.leaveRequestId().toString());
            data.put("route", ROUTE_LEAVE_HISTORY);
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
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
            String body = "%s cancelled their %s from %s to %s.".formatted(
                    employeeName != null ? employeeName : "An employee",
                    leaveTypeName, fmt(e.startDate()), fmt(e.endDate()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.LEAVE_CANCELLED.name());
            data.put("leaveRequestId", e.leaveRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), e.approverId(),
                    AppNotificationType.LEAVE_CANCELLED,
                    "Leave request cancelled", body, data);
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
            String body = "%s requested to work from home %s.".formatted(
                    employeeName != null ? employeeName : "An employee",
                    range(e.fromDate(), e.toDate()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.WFH_SUBMITTED.name());
            data.put("wfhRequestId", e.wfhRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), e.approverId(),
                    AppNotificationType.WFH_SUBMITTED,
                    "New WFH request", body, data);
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
            String title = e.approved() ? "WFH approved" : "WFH rejected";
            String body = e.approved()
                    ? "Your work-from-home request for %s has been approved.".formatted(range(e.fromDate(), e.toDate()))
                    : "Your work-from-home request for %s has been rejected.%s".formatted(
                            range(e.fromDate(), e.toDate()),
                            e.comment() != null && !e.comment().isBlank() ? " Reason: " + e.comment() : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("wfhRequestId", e.wfhRequestId().toString());
            data.put("route", ROUTE_MY_WFH);
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
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
            String body = "%s cancelled their work-from-home request for %s.".formatted(
                    employeeName != null ? employeeName : "An employee",
                    range(e.fromDate(), e.toDate()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.WFH_CANCELLED.name());
            data.put("wfhRequestId", e.wfhRequestId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), e.approverId(),
                    AppNotificationType.WFH_CANCELLED,
                    "WFH request cancelled", body, data);
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
            String body = "%s requested an attendance correction for %s.".formatted(
                    employeeName != null ? employeeName : "An employee",
                    fmt(e.requestedDate()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.CORRECTION_SUBMITTED.name());
            data.put("correctionId", e.correctionId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), approverId,
                    AppNotificationType.CORRECTION_SUBMITTED,
                    "New correction request", body, data);
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
            String title = e.approved() ? "Correction approved" : "Correction rejected";
            String body = e.approved()
                    ? "Your attendance correction for %s has been approved.".formatted(fmt(e.requestedDate()))
                    : "Your attendance correction for %s has been rejected.%s".formatted(
                            fmt(e.requestedDate()),
                            e.comment() != null && !e.comment().isBlank() ? " Reason: " + e.comment() : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("correctionId", e.correctionId().toString());
            data.put("route", ROUTE_MY_CORRECTIONS);
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
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
            String who = employeeName != null ? employeeName : "An employee";
            String body = e.effectiveDate() != null
                    ? "%s requested to move to the %s shift from %s.".formatted(who, shift, fmt(e.effectiveDate()))
                    : "%s requested to move to the %s shift.".formatted(who, shift);
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.SHIFT_CHANGE_SUBMITTED.name());
            data.put("shiftChangeRequestId", e.requestId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), approverId,
                    AppNotificationType.SHIFT_CHANGE_SUBMITTED,
                    "New shift change request", body, data);
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
            String title = e.approved() ? "Shift change approved" : "Shift change rejected";
            String shift = e.requestedShiftName() != null ? e.requestedShiftName() : "the requested shift";
            String body;
            if (!e.approved()) {
                body = "Your request to move to %s was rejected.%s".formatted(shift,
                        e.comment() != null && !e.comment().isBlank() ? " Reason: " + e.comment() : "");
            } else if (e.effectiveDate() == null) {
                body = "Your shift has been changed to %s.".formatted(shift);
            } else {
                body = "Your shift changes to %s from %s.".formatted(shift, fmt(e.effectiveDate()));
            }
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("shiftChangeRequestId", e.requestId().toString());
            data.put("route", "/shift-change");
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
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
            service.create(e.tenantId(), e.employeeId(),
                    AppNotificationType.WELCOME,
                    "Welcome to " + org,
                    "Your account is active. Punch in, apply for leave, and track attendance right here.",
                    data);
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
            String title = e.success() ? "Face enrolment complete" : "Face enrolment failed";
            String body = e.success()
                    ? "You can now punch in with your face."
                    : (e.reason() != null && !e.reason().isBlank()
                            ? e.reason()
                            : "Please ask your manager to reset your face enrolment.");
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("route", "/face-enroll");
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
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
            String body = "%s submitted an expense claim%s: %s.".formatted(who,
                    e.amount() != null ? " for " + money(e.currency(), e.amount()) : "",
                    e.title() != null ? e.title() : "claim");
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.EXPENSE_SUBMITTED.name());
            data.put("expenseClaimId", e.claimId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), e.approverId(), AppNotificationType.EXPENSE_SUBMITTED,
                    "New expense claim to review", body, data);
        } catch (Exception ex) {
            log.warn("Failed to publish EXPENSE_SUBMITTED notification for {}: {}", e.claimId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onExpenseDecided(ExpenseClaimDecidedEvent e) {
        try {
            AppNotificationType type = e.approved() ? AppNotificationType.EXPENSE_APPROVED : AppNotificationType.EXPENSE_REJECTED;
            String title = e.approved() ? "Expense claim approved" : "Expense claim rejected";
            String what = e.title() != null ? e.title() : "your expense claim";
            String amt = e.amount() != null ? " (" + money(e.currency(), e.amount()) + ")" : "";
            String body = e.approved()
                    ? "Your claim %s%s was approved.".formatted(what, amt)
                    : "Your claim %s%s was rejected.%s".formatted(what, amt,
                            e.comment() != null && !e.comment().isBlank() ? " Reason: " + e.comment() : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("expenseClaimId", e.claimId().toString());
            data.put("route", "/my-claims");
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
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
            String body = "%s requested a salary advance of %s.".formatted(who, money("INR", e.amount()));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.ADVANCE_SUBMITTED.name());
            data.put("advanceRequestId", e.advanceId().toString());
            data.put("route", ROUTE_APPROVALS);
            service.create(e.tenantId(), e.approverId(), AppNotificationType.ADVANCE_SUBMITTED,
                    "New advance request to review", body, data);
        } catch (Exception ex) {
            log.warn("Failed to publish ADVANCE_SUBMITTED notification for {}: {}", e.advanceId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onAdvanceDecided(AdvanceRequestDecidedEvent e) {
        try {
            AppNotificationType type = e.approved() ? AppNotificationType.ADVANCE_APPROVED : AppNotificationType.ADVANCE_REJECTED;
            String title = e.approved() ? "Advance request approved" : "Advance request rejected";
            String body = e.approved()
                    ? "Your advance request of %s was approved.".formatted(money("INR", e.amount()))
                    : "Your advance request of %s was rejected.%s".formatted(money("INR", e.amount()),
                            e.comment() != null && !e.comment().isBlank() ? " Reason: " + e.comment() : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("advanceRequestId", e.advanceId().toString());
            data.put("route", "/my-advances");
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
            markSubmissionReadSafely(e.advanceId());
        } catch (Exception ex) {
            log.warn("Failed to publish ADVANCE decision notification for {}: {}", e.advanceId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onOvertimeDecided(OvertimeDecidedEvent e) {
        try {
            AppNotificationType type = e.approved() ? AppNotificationType.OVERTIME_APPROVED : AppNotificationType.OVERTIME_REJECTED;
            String title = e.approved() ? "Overtime approved" : "Overtime rejected";
            String hours = "%.1fh".formatted(e.minutes() / 60.0);
            String body = e.approved()
                    ? "Your overtime of %s on %s was approved. Recorded, not paid.".formatted(hours, fmt(e.onDate()))
                    : "Your overtime of %s on %s was rejected.%s".formatted(hours, fmt(e.onDate()),
                            e.comment() != null && !e.comment().isBlank() ? " Reason: " + e.comment() : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", type.name());
            data.put("overtimeId", e.overtimeId().toString());
            data.put("route", "/attendance");
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
        } catch (Exception ex) {
            log.warn("Failed to publish OVERTIME decision notification for {}: {}", e.overtimeId(), ex.getMessage());
        }
    }

    // ─── Document verification ─────────────────────────────────────────────
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDocumentUploaded(DocumentUploadedEvent e) {
        try {
            UUID hr = firstEmployeeWithRole(e.tenantId(), HR_MANAGER);
            if (hr == null) hr = firstEmployeeWithRole(e.tenantId(), SUPER_ADMIN);
            if (hr == null) return;
            String who = firstOrElse(resolveEmployeeName(e.employeeId(), e.tenantId()), "An employee");
            String body = "%s uploaded their %s. Please review.".formatted(who,
                    firstOrElse(e.documentTypeName(), "document"));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.DOCUMENT_UPLOADED.name());
            data.put("documentId", e.documentId().toString());
            data.put("employeeId", e.employeeId().toString());
            data.put("route", "/documents/pending");
            service.create(e.tenantId(), hr, AppNotificationType.DOCUMENT_UPLOADED,
                    "New document to verify", body, data);
        } catch (Exception ex) {
            log.warn("Failed to publish DOCUMENT_UPLOADED notification for {}: {}", e.documentId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDocumentVerified(DocumentVerifiedEvent e) {
        try {
            String body = "Your %s has been verified by HR.".formatted(firstOrElse(e.documentTypeName(), "document"));
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.DOCUMENT_VERIFIED.name());
            data.put("documentId", e.documentId().toString());
            data.put("route", "/profile");
            service.create(e.tenantId(), e.employeeId(), AppNotificationType.DOCUMENT_VERIFIED,
                    "Document verified", body, data);
        } catch (Exception ex) {
            log.warn("Failed to publish DOCUMENT_VERIFIED notification for {}: {}", e.documentId(), ex.getMessage());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onDocumentRejected(DocumentRejectedEvent e) {
        try {
            String body = "Your %s was rejected.%s Please re-upload.".formatted(
                    firstOrElse(e.documentTypeName(), "document"),
                    e.reason() != null && !e.reason().isBlank() ? " Reason: " + e.reason() : "");
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.DOCUMENT_REJECTED.name());
            data.put("documentId", e.documentId().toString());
            data.put("route", "/profile");
            service.create(e.tenantId(), e.employeeId(), AppNotificationType.DOCUMENT_REJECTED,
                    "Document needs re-upload", body, data);
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
}
