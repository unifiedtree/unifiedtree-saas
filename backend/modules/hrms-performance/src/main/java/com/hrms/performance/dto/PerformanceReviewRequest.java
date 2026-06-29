package com.hrms.performance.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record PerformanceReviewRequest(
        @NotNull UUID cycleId,
        @NotNull UUID employeeId
) {}
