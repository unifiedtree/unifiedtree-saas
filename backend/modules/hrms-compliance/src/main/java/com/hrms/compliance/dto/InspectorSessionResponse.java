package com.hrms.compliance.dto;

import com.hrms.compliance.enums.InspectorSessionStatus;
import java.time.Instant;
import java.util.UUID;

public record InspectorSessionResponse(
        UUID id,
        UUID companyId,
        String inspectorName,
        String inspectorOrg,
        String purpose,
        String accessCode,
        InspectorSessionStatus status,
        Instant expiresAt,
        Instant lastAccessedAt,
        Instant revokedAt,
        String notes,
        Instant createdAt
) {}
