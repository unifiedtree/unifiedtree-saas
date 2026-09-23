package com.hrms.compliance.dto;

import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import java.util.UUID;

public record InspectorSessionRequest(
        UUID companyId,
        @NotBlank String inspectorName,
        String inspectorOrg,
        @NotBlank String purpose,
        Instant expiresAt,
        String notes
) {}
