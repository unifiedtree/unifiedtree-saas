package com.hrms.attendance.dto;

import java.time.Instant;
import java.util.UUID;

public record AttendanceCheckinEvent(
        UUID attendanceRecordId,
        UUID employeeId,
        UUID tenantId,
        UUID companyId,
        UUID departmentId,
        UUID branchId,
        Instant checkInAt,
        String checkInMethod,
        Instant occurredAt
) {}
