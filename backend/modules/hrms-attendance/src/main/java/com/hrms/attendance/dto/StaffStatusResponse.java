package com.hrms.attendance.dto;

import java.time.Instant;
import java.util.UUID;

public record StaffStatusResponse(
        UUID employeeId,
        String employeeCode,
        String fullName,
        String jobTitle,
        UUID departmentId,
        String departmentName,
        String profilePhotoUrl,
        String status,
        Instant checkInAt,
        Instant checkOutAt,
        String locationName,
        Double latitude,
        Double longitude
) {
}
