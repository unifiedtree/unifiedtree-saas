package com.hrms.learning.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

import java.math.BigDecimal;

public record CompleteEnrollmentRequest(
        // Optional final assessment score on a 0–100 scale.
        @DecimalMin("0.0") @DecimalMax("100.0") BigDecimal score
) {}
