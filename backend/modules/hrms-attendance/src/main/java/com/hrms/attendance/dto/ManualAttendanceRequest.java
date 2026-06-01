package com.hrms.attendance.dto;

import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record ManualAttendanceRequest(
        @NotNull UUID employeeId,
        @NotNull LocalDate attendanceDate,
        Instant checkInAt,
        Instant checkOutAt,
        String attendanceType,
        String attendanceStatus,
        Double latitude,
        Double longitude,
        String locationName,
        @NotNull String reason
) {
}
