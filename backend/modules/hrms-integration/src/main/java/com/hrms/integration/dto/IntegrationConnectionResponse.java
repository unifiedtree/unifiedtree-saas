package com.hrms.integration.dto;

import com.hrms.integration.enums.IntegrationStatus;

import java.time.Instant;
import java.util.UUID;

public record IntegrationConnectionResponse(
        UUID id,
        UUID companyId,
        String name,
        String provider,
        String category,
        IntegrationStatus status,
        String configSummary,
        Instant lastSyncedAt,
        Instant createdAt
) {}
