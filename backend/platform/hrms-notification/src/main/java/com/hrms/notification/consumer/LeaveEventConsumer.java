package com.hrms.notification.consumer;

import com.hrms.notification.dto.SendNotificationCommand;
import com.hrms.notification.enums.NotificationChannel;
import com.hrms.notification.enums.NotificationType;
import com.hrms.notification.service.LeaveEmailService;
import com.hrms.notification.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

@Component
public class LeaveEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(LeaveEventConsumer.class);

    private final NotificationDispatcher dispatcher;
    private final LeaveEmailService leaveEmailService;

    public LeaveEventConsumer(NotificationDispatcher dispatcher, LeaveEmailService leaveEmailService) {
        this.dispatcher = dispatcher;
        this.leaveEmailService = leaveEmailService;
    }

    @KafkaListener(topics = "leave.requested.v1", groupId = "hrms-notification")
    public void handleLeaveRequested(Map<String, Object> event) {
        try {
            UUID tenantId   = uuid(event, "tenantId");
            UUID approverId = uuid(event, "approverId");
            String leaveType = str(event, "leaveTypeName");

            // IN_APP — unchanged
            if (approverId != null) {
                dispatcher.dispatch(new SendNotificationCommand(
                        approverId, tenantId,
                        NotificationType.LEAVE_REQUESTED,
                        "Leave approval required",
                        "An employee has applied for %s. Please review.".formatted(leaveType),
                        NotificationChannel.IN_APP,
                        uuid(event, "leaveRequestId"),
                        "LEAVE_REQUEST", null));
            }

            // EMAIL — manager notified
            leaveEmailService.sendLeaveRequested(
                    str(event, "approverEmail"),
                    str(event, "approverName"),
                    str(event, "employeeName"),
                    leaveType,
                    localDate(event, "startDate"),
                    localDate(event, "endDate"),
                    totalDays(event),
                    null);

        } catch (Exception e) {
            log.error("Failed to process leave.requested.v1: {}", e.getMessage(), e);
        }
    }

    @KafkaListener(topics = "leave.approved.v1", groupId = "hrms-notification")
    public void handleLeaveApproved(Map<String, Object> event) {
        try {
            UUID employeeId = uuid(event, "employeeId");
            UUID tenantId   = uuid(event, "tenantId");
            String status   = str(event, "status");
            boolean approved = "APPROVED".equals(status);

            // IN_APP — unchanged
            dispatcher.dispatch(new SendNotificationCommand(
                    employeeId, tenantId,
                    approved ? NotificationType.LEAVE_APPROVED : NotificationType.LEAVE_REJECTED,
                    approved ? "Leave approved" : "Leave rejected",
                    approved ? "Your leave request has been approved."
                             : "Your leave request has been rejected. Contact your manager for details.",
                    NotificationChannel.IN_APP,
                    uuid(event, "leaveRequestId"),
                    "LEAVE_REQUEST", null));

            // EMAIL — employee notified
            if (approved) {
                leaveEmailService.sendLeaveApproved(
                        str(event, "employeeEmail"),
                        str(event, "employeeName"),
                        str(event, "leaveTypeName"),
                        localDate(event, "startDate"),
                        localDate(event, "endDate"),
                        null);
            } else {
                leaveEmailService.sendLeaveRejected(
                        str(event, "employeeEmail"),
                        str(event, "employeeName"),
                        str(event, "leaveTypeName"),
                        localDate(event, "startDate"),
                        localDate(event, "endDate"),
                        str(event, "approverComment"),
                        null);
            }

        } catch (Exception e) {
            log.error("Failed to process leave.approved.v1: {}", e.getMessage(), e);
        }
    }

    @KafkaListener(topics = "leave.cancelled.v1", groupId = "hrms-notification")
    public void handleLeaveCancelled(Map<String, Object> event) {
        try {
            UUID employeeId = uuid(event, "employeeId");
            UUID tenantId   = uuid(event, "tenantId");
            UUID approverId = uuid(event, "approverId");

            // IN_APP — employee
            dispatcher.dispatch(new SendNotificationCommand(
                    employeeId, tenantId,
                    NotificationType.LEAVE_CANCELLED,
                    "Leave request cancelled",
                    "Your leave request has been cancelled.",
                    NotificationChannel.IN_APP,
                    uuid(event, "leaveRequestId"),
                    "LEAVE_REQUEST", null));

            // IN_APP — approver
            if (approverId != null) {
                dispatcher.dispatch(new SendNotificationCommand(
                        approverId, tenantId,
                        NotificationType.LEAVE_CANCELLED,
                        "Leave request cancelled",
                        "A pending leave request has been cancelled by the employee.",
                        NotificationChannel.IN_APP,
                        uuid(event, "leaveRequestId"),
                        "LEAVE_REQUEST", null));
            }

            // EMAIL — employee + approver
            leaveEmailService.sendLeaveCancelled(
                    str(event, "employeeEmail"),
                    str(event, "employeeName"),
                    str(event, "approverEmail"),
                    str(event, "approverName"),
                    str(event, "leaveTypeName"),
                    localDate(event, "startDate"),
                    localDate(event, "endDate"),
                    str(event, "cancellationReason"));

        } catch (Exception e) {
            log.error("Failed to process leave.cancelled.v1: {}", e.getMessage(), e);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static UUID uuid(Map<String, Object> event, String key) {
        Object v = event.get(key);
        return v != null ? UUID.fromString(v.toString()) : null;
    }

    private static String str(Map<String, Object> event, String key) {
        Object v = event.get(key);
        return v != null ? v.toString() : null;
    }

    private static LocalDate localDate(Map<String, Object> event, String key) {
        Object v = event.get(key);
        return v != null ? LocalDate.parse(v.toString()) : null;
    }

    private static double totalDays(Map<String, Object> event) {
        Object v = event.get("totalDays");
        return v instanceof Number n ? n.doubleValue() : 0;
    }
}
