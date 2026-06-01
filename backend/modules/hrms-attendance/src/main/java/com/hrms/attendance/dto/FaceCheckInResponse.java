package com.hrms.attendance.dto;

import java.time.Instant;
import java.util.UUID;

public record FaceCheckInResponse(
        boolean success,
        UUID attendanceRecordId,
        Instant checkInAt,
        String message,
        double confidenceScore
) {}
