package com.hrms.performance.dto;

import com.hrms.performance.enums.GoalStatus;

import java.time.Instant;
import java.math.BigDecimal;
import java.util.UUID;

public record GoalResponse(
        UUID id,
        UUID employeeId,
        UUID cycleId,
        String title,
        String description,
        int weight,
        int progress,
        GoalStatus status,
        Instant createdAt,
        BigDecimal targetValue,
        BigDecimal currentValue,
        String unit
) {}
