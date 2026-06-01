package com.hrms.notification.consumer;

import com.hrms.notification.dto.SendNotificationCommand;
import com.hrms.notification.enums.NotificationChannel;
import com.hrms.notification.enums.NotificationType;
import com.hrms.notification.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Component
public class AttendanceEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(AttendanceEventConsumer.class);

    private final NotificationDispatcher dispatcher;
    private final SimpMessagingTemplate messagingTemplate;

    public AttendanceEventConsumer(NotificationDispatcher dispatcher,
                                   SimpMessagingTemplate messagingTemplate) {
        this.dispatcher = dispatcher;
        this.messagingTemplate = messagingTemplate;
    }

    @KafkaListener(topics = "attendance.checkin.v1", groupId = "hrms-notification")
    public void handleAttendanceCheckIn(Map<String, Object> event) {
        try {
            UUID employeeId = UUID.fromString((String) event.get("employeeId"));
            UUID tenantId = UUID.fromString((String) event.get("tenantId"));
            UUID departmentId = event.get("departmentId") != null
                    ? UUID.fromString((String) event.get("departmentId")) : null;

            // Push live update to dept manager's attendance dashboard
            if (departmentId != null) {
                messagingTemplate.convertAndSend(
                        "/topic/dept/" + departmentId + "/attendance", event);
                log.debug("Pushed attendance event to dept topic: {}", departmentId);
            }

            // In-app notification to the employee
            dispatcher.dispatch(new SendNotificationCommand(
                    employeeId, tenantId,
                    NotificationType.ATTENDANCE_CHECKED_IN,
                    "Check-in recorded",
                    "Your attendance has been marked successfully.",
                    NotificationChannel.IN_APP,
                    UUID.fromString((String) event.get("attendanceRecordId")),
                    "ATTENDANCE_RECORD", null));
        } catch (Exception e) {
            log.error("Failed to process attendance.checkin.v1 event: {}", e.getMessage(), e);
        }
    }
}
