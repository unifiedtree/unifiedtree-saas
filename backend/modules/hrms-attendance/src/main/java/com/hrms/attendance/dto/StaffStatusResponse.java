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
        boolean earlyCheckout,
        // OFFICE / WFH / FIELD — the record's attendance TYPE, which is a
        // different axis from `status`. The dashboard's "Work From Home" tile
        // counts by this field (countSummary), never by status, so a client
        // that only has `status` cannot reproduce that bucket. Null when the
        // employee has no record for the date.
        String attendanceType,
        // True when the employee has APPROVED leave covering this date. The
        // "On Leave" tile counts these, and "Absent" is defined as no punch AND
        // not on leave — neither is reproducible from the punch alone, because
        // leave lives in a different module entirely.
        boolean onLeave
) {
}
