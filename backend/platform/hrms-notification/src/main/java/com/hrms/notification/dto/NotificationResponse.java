package com.hrms.notification.dto;

import com.hrms.notification.enums.NotificationChannel;
import com.hrms.notification.enums.NotificationType;

import java.time.Instant;
import java.util.UUID;

public record NotificationResponse(
        UUID id,
        NotificationType type,
        String title,
        String body,
        NotificationChannel channel,
        boolean read,
        Instant readAt,
        UUID referenceId,
        String referenceType,
        String actionUrl,
        Instant createdAt
) {}
