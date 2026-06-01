package com.hrms.tenant.dto;

import com.hrms.tenant.enums.SubscriptionTier;

import java.time.Instant;
import java.util.UUID;

public record CompanyResponse(
        UUID id,
        UUID tenantId,
        String name,
        String domain,
        String industry,
        String country,
        String timezone,
        String currency,
        SubscriptionTier subscriptionTier,
        int maxEmployees,
        boolean isActive,
        Instant createdAt
) {
}
