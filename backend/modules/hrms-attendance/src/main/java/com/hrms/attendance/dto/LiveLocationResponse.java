package com.hrms.attendance.dto;

import java.time.Instant;
import java.util.UUID;

public record LiveLocationResponse(
        UUID employeeId,
        String fullName,
        String jobTitle,
        String profilePhotoUrl,
        Double latitude,
        Double longitude,
        String locationName,
        String zoneName,
        Instant lastSeenAt,
        boolean live
) {
}
