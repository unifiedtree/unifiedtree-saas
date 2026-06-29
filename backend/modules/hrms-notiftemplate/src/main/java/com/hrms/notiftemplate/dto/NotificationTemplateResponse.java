package com.hrms.notiftemplate.dto;

import com.hrms.notiftemplate.enums.NotificationChannel;

import java.time.Instant;
import java.util.UUID;

public record NotificationTemplateResponse(
        UUID id,
        UUID companyId,
        String name,
        NotificationChannel channel,
        String eventKey,
        String subject,
        String body,
        boolean active,
        Instant createdAt
) {}
