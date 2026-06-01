package com.hrms.notification.dto;

import com.hrms.notification.enums.NotificationType;

import java.time.Instant;
import java.util.UUID;

public record WebSocketPayload(
        UUID notificationId,
        NotificationType type,
        String title,
        String body,
        UUID referenceId,
        Instant timestamp
) {}
