package com.hrms.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Employee-filed attendance correction request.
 *
 * <p>{@code requestedDate} is the day being corrected. It must be a real past-or-
 * today date — a QA sweep found the endpoint accepting year-1900 / 2099. In
 * addition to the field-level {@code @PastOrPresent}, {@code AttendanceService
 * .createCorrectionRequest} caps the look-back at 90 days ({@code
 * CORRECTION_DATE_TOO_OLD}); older gaps go through payroll adjustment, not the
 * self-serve correction form.
 */
public record CorrectionRequestRequest(
        UUID attendanceRecordId,
        @NotNull @PastOrPresent LocalDate requestedDate,
        Instant requestedCheckInAt,
        Instant requestedCheckOutAt,
        @NotBlank String reason,
        String attachmentUrl
) {
}
