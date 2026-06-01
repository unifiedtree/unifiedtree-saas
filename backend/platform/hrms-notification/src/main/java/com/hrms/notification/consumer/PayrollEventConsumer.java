package com.hrms.notification.consumer;

import com.hrms.notification.dto.SendNotificationCommand;
import com.hrms.notification.enums.NotificationChannel;
import com.hrms.notification.enums.NotificationType;
import com.hrms.notification.service.NotificationDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class PayrollEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(PayrollEventConsumer.class);

    private final NotificationDispatcher dispatcher;

    public PayrollEventConsumer(NotificationDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @SuppressWarnings("unchecked")
    @KafkaListener(topics = "payroll.run.completed.v1", groupId = "hrms-notification")
    public void handlePayrollCompleted(Map<String, Object> event) {
        try {
            UUID tenantId = UUID.fromString((String) event.get("tenantId"));
            List<String> employeeIds = (List<String>) event.get("employeeIds");
            if (employeeIds == null) return;

            employeeIds.forEach(empId -> dispatcher.dispatch(new SendNotificationCommand(
                    UUID.fromString(empId), tenantId,
                    NotificationType.PAYSLIP_PUBLISHED,
                    "Your payslip is ready",
                    "Your payslip for this month has been published. Tap to view.",
                    NotificationChannel.IN_APP,
                    UUID.fromString((String) event.get("payrollRunId")),
                    "PAYROLL_RUN", "/payslips")));
        } catch (Exception e) {
            log.error("Failed to process payroll.run.completed.v1: {}", e.getMessage(), e);
        }
    }
}
