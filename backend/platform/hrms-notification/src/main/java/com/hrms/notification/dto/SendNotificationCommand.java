package com.hrms.notification.dto;

import com.hrms.notification.enums.NotificationChannel;
import com.hrms.notification.enums.NotificationType;

import java.util.UUID;

public record SendNotificationCommand(
        UUID recipientId,
        UUID tenantId,
        NotificationType type,
        String title,
        String body,
        NotificationChannel channel,
        UUID referenceId,
        String referenceType,
        String actionUrl
) {}
