package com.hrms.hiring.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;

public record CandidateRequest(
        @NotBlank String fullName,
        @Email String email,
        String phone,
        String source,
        @PositiveOrZero BigDecimal expectedCtc,
        String notes
) {}
