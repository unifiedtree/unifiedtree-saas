package com.hrms.notification.consumer;

import com.hrms.notification.dto.SendNotificationCommand;
import com.hrms.notification.enums.NotificationChannel;
import com.hrms.notification.enums.NotificationType;
import com.hrms.notification.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Component
public class LeaveEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(LeaveEventConsumer.class);

    private final NotificationDispatcher dispatcher;

    public LeaveEventConsumer(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @KafkaListener(topics = "leave.requested.v1", groupId = "hrms-notification")
    public void handleLeaveRequested(Map<String, Object> event) {
        try {
            UUID approverId = event.get("approverId") != null
                    ? UUID.fromString((String) event.get("approverId")) : null;
            UUID tenantId = UUID.fromString((String) event.get("tenantId"));
            String leaveTypeName = (String) event.get("leaveTypeName");

            if (approverId != null) {
                dispatcher.dispatch(new SendNotificationCommand(
                        approverId, tenantId,
                        NotificationType.LEAVE_REQUESTED,
                        "Leave approval required",
                        "An employee has applied for %s. Please review.".formatted(leaveTypeName),
                        NotificationChannel.IN_APP,
                        UUID.fromString((String) event.get("leaveRequestId")),
                        "LEAVE_REQUEST", null));
            }
        } catch (Exception e) {
            log.error("Failed to process leave.requested.v1: {}", e.getMessage(), e);
        }
    }

    @KafkaListener(topics = "leave.approved.v1", groupId = "hrms-notification")
    public void handleLeaveApproved(Map<String, Object> event) {
        try {
            UUID employeeId = UUID.fromString((String) event.get("employeeId"));
            UUID tenantId = UUID.fromString((String) event.get("tenantId"));
            String status = (String) event.get("status");
            boolean approved = "APPROVED".equals(status);

            dispatcher.dispatch(new SendNotificationCommand(
                    employeeId, tenantId,
                    approved ? NotificationType.LEAVE_APPROVED : NotificationType.LEAVE_REJECTED,
                    approved ? "Leave approved" : "Leave rejected",
                    approved ? "Your leave request has been approved."
                              : "Your leave request has been rejected. Contact your manager for details.",
                    NotificationChannel.IN_APP,
                    UUID.fromString((String) event.get("leaveRequestId")),
                    "LEAVE_REQUEST", null));
        } catch (Exception e) {
            log.error("Failed to process leave.approved.v1: {}", e.getMessage(), e);
        }
    }
}
