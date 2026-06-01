package com.hrms.tenant.dto;

import com.hrms.tenant.enums.SubscriptionTier;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record CompanyRequest(
        @NotBlank String name,
        String domain,
        String industry,
        String country,
        String timezone,
        String currency,
        @NotNull SubscriptionTier subscriptionTier,
        @Positive int maxEmployees
) {
}
