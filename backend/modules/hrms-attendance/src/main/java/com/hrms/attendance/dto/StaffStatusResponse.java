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
        Double longitude,
        // True when the employee has a non-null check_out_at and that checkout,
        // converted to IST wall-clock, is strictly before their assigned shift's
        // end_time. Used by the mobile dashboard's Early Out tile and drill-down.
        // Absent shift assignment / absent end_time / no checkout -> false.
        boolean earlyCheckout
) {
}
