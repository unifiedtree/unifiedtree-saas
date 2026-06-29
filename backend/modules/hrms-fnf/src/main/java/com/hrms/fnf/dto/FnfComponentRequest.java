package com.hrms.fnf.dto;

import com.hrms.fnf.enums.FnfComponentType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;

public record FnfComponentRequest(
        @NotBlank String label,
        @NotNull FnfComponentType type,
        @NotNull @PositiveOrZero BigDecimal amount
) {}
