package com.hrms.letters.dto;

import jakarta.validation.constraints.NotNull;

import java.util.Map;
import java.util.UUID;

public record PreviewTemplateRequest(
        @NotNull UUID employeeId,
        Map<String, String> overrides
) {}
