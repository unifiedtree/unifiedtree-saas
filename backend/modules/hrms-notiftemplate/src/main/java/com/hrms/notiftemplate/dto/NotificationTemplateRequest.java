package com.hrms.notiftemplate.dto;

import com.hrms.notiftemplate.enums.NotificationChannel;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record NotificationTemplateRequest(
        // Optional — the controller defaults to the caller's company when null.
        UUID companyId,
        @NotBlank String name,
        @NotNull NotificationChannel channel,
        @NotBlank String eventKey,
        String subject,
        @NotBlank String body,
        Boolean active
) {}
