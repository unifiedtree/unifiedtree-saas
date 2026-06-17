package com.hrms.letters.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record CreateDistributionRequest(
        @NotNull(message = "Template ID is required")
        UUID templateId,

        @NotBlank(message = "Title is required")
        @Size(max = 200)
        String title,

        String customMessage,

        @Size(max = 500)
        String subjectOverride,

        @NotNull(message = "Recipient filter is required")
        RecipientFilter recipientFilter
) {}
