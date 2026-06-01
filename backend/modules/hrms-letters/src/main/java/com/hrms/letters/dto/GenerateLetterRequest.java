package com.hrms.letters.dto;

import jakarta.validation.constraints.NotNull;

import java.util.Map;
import java.util.UUID;

public record GenerateLetterRequest(
        @NotNull(message = "Template ID is required")
        UUID templateId,

        @NotNull(message = "Employee ID is required")
        UUID employeeId,

        Map<String, String> overrides,

        boolean sendImmediately,

        String sendToEmail
) {}
