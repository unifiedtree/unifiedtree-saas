package com.hrms.employee.dto;

import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;

public record TerminationRequest(
        @NotNull LocalDate dateOfTermination,
        String reason,
        boolean isResignation
) {}
