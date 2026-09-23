package com.hrms.pli.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record PliTargetRequest(
        UUID companyId,
        @NotBlank String title,
        String ownerType,
        UUID ownerId,
        @NotBlank String period,
        @NotBlank String metric,
        @NotNull BigDecimal targetValue,
        BigDecimal actualValue,
        BigDecimal weightPercent,
        BigDecimal payoutAmount,
        String status,
        String notes
) {}
