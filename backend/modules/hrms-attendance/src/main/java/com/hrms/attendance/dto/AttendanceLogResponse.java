package com.hrms.attendance.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record AttendanceLogResponse(
        UUID eventId,
        UUID attendanceRecordId,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        String departmentName,
        LocalDate eventDate,
        Instant eventAt,
        String eventType,
        String attendanceStatus,
        String locationName,
        String zoneName,
        String note
) {
}
