package com.hrms.advance.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

public record AdvanceRequestCreateRequest(
        @NotNull @DecimalMin(value = "0.01", message = "Advance amount must be greater than zero") BigDecimal amount,
        String reason,
        @NotNull @Min(value = 1, message = "Repayment must be at least 1 month")
        @Max(value = 60, message = "Repayment cannot exceed 60 months") Integer repaymentMonths
) {}
