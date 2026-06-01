package com.hrms.attendance.dto;

import java.time.Instant;
import java.util.UUID;

public record CheckOutSummaryResponse(
        UUID attendanceRecordId,
        Instant startedAt,
        double totalDurationHours,
        long totalDurationMinutes,
        String locationName,
        boolean shortSessionWarning
) {
}
