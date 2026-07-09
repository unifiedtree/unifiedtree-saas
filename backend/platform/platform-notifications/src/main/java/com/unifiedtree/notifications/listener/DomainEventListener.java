package com.unifiedtree.notifications.listener;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.events.FaceEnrollmentEvent;
import com.unifiedtree.notifications.events.LeaveDecidedEvent;
import com.unifiedtree.notifications.events.LeaveRequestSubmittedEvent;
import com.unifiedtree.notifications.service.AppNotificationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
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
 * <p>WFH stub: the WFH module has not shipped yet. When it does, publish a
 * {@code WfhRequestSubmittedEvent} / {@code WfhDecidedEvent} and add handlers
 * here that call {@code AppNotificationService.create} with
 * {@link AppNotificationType#WFH_SUBMITTED} / {@link AppNotificationType#WFH_APPROVED}.
 */
@Component
public class DomainEventListener {

    private static final Logger log = LoggerFactory.getLogger(DomainEventListener.class);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("d MMM yyyy");

    private final AppNotificationService service;
    private final JdbcTemplate jdbc;

    public DomainEventListener(AppNotificationService service, JdbcTemplate jdbc) {
        this.service = service;
        this.jdbc = jdbc;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Leave
    // ────────────────────────────────────────────────────────────────────────

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onLeaveSubmitted(LeaveRequestSubmittedEvent e) {
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
            data.put("route", "/requests-tab");
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

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
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
            data.put("route", "/leave-history");
            service.create(e.tenantId(), e.employeeId(), type, title, body, data);
        } catch (Exception ex) {
            log.warn("Failed to publish LEAVE decision notification for {}: {}",
                    e.leaveRequestId(), ex.getMessage());
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Face enrollment
    // ────────────────────────────────────────────────────────────────────────

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
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
        if (employeeId == null || tenantId == null) return null;
        try {
            return jdbc.queryForObject(
                    "SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) "
                            + "FROM hrms.employees WHERE id = ? AND tenant_id = ? LIMIT 1",
                    String.class, employeeId, tenantId);
        } catch (EmptyResultDataAccessException ex) {
            return null;
        } catch (Exception ex) {
            log.debug("resolveEmployeeName lookup failed for {}: {}", employeeId, ex.getMessage());
            return null;
        }
    }

    private static String fmt(LocalDate d) {
        return d == null ? "" : DATE_FMT.format(d);
    }
}
