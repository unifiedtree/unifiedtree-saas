package com.hrms.integration.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record IntegrationConnectionRequest(
        @NotNull UUID companyId,
        @NotBlank @jakarta.validation.constraints.Size(max=150) String name,
        @NotBlank @jakarta.validation.constraints.Size(max=80) String provider,
        @jakarta.validation.constraints.Size(max=50) String category,
        @jakarta.validation.constraints.Size(max=5000) String configSummary
) {}
