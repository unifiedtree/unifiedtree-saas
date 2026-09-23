package com.hrms.pli.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record PliTargetResponse(
        UUID id,
        UUID companyId,
        String title,
        String ownerType,
        UUID ownerId,
        String period,
        String metric,
        BigDecimal targetValue,
        BigDecimal actualValue,
        BigDecimal weightPercent,
        BigDecimal payoutAmount,
        String status,
        String notes,
        Instant createdAt
) {}
