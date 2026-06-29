package com.hrms.integration.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record IntegrationConnectionRequest(
        @NotNull UUID companyId,
        @NotBlank String name,
        @NotBlank String provider,
        String category,
        String configSummary
) {}
