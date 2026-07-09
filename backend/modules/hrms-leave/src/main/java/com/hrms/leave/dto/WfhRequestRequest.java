package com.hrms.leave.dto;

import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

public record WfhRequestRequest(
        @NotNull(message = "Start date is required")
        @FutureOrPresent(message = "Start date cannot be in the past")
        LocalDate fromDate,

        @NotNull(message = "End date is required")
        @FutureOrPresent(message = "End date cannot be in the past")
        LocalDate toDate,

        @Size(max = 500, message = "Reason must be 500 characters or fewer")
        String reason
) {
}
