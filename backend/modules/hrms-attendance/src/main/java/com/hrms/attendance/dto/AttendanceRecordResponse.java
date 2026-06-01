package com.hrms.attendance.dto;

import com.hrms.attendance.enums.AttendanceType;
import com.hrms.attendance.enums.AttendanceStatus;
import com.hrms.attendance.enums.CheckInMethod;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record AttendanceRecordResponse(
        UUID id,
        UUID employeeId,
        LocalDate attendanceDate,
        Instant checkInAt,
        Instant checkOutAt,
        AttendanceStatus attendanceStatus,
        AttendanceType attendanceType,
        CheckInMethod checkInMethod,
        CheckInMethod checkOutMethod,
        Double workingHours,
        boolean regularized,
        String locationName,
        String checkInZoneName,
        String checkOutZoneName,
        Integer lateByMinutes,
        Integer overtimeMinutes,
        boolean manualEntry
) {}
