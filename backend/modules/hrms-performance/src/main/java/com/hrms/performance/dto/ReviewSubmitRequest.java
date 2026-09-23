package com.hrms.performance.dto;

import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

public record ReviewSubmitRequest(
        @NotNull @jakarta.validation.constraints.DecimalMin("0") @jakarta.validation.constraints.DecimalMax("5") BigDecimal overallRating,
        String strengths,
        String improvements
) {}
