package com.hrms.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record CorrectionRequestRequest(
        UUID attendanceRecordId,
        @NotNull LocalDate requestedDate,
        Instant requestedCheckInAt,
        Instant requestedCheckOutAt,
        @NotBlank String reason,
        String attachmentUrl
) {
}
