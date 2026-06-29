package com.hrms.performance.dto;

import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

public record ReviewSubmitRequest(
        @NotNull BigDecimal overallRating,
        String strengths,
        String improvements
) {}
