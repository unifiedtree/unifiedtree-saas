package com.hrms.leave.dto;

import com.hrms.leave.enums.LeaveDuration;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.UUID;

public record LeaveRequestRequest(
        @NotNull(message = "Leave type ID is required")
        UUID leaveTypeId,

        @NotNull(message = "Start date is required")
        LocalDate startDate,

        @NotNull(message = "End date is required")
        LocalDate endDate,

        @NotNull(message = "Duration is required")
        LeaveDuration duration,

        String reason
) {
}
