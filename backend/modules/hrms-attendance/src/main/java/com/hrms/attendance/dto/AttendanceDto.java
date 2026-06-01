package com.hrms.attendance.dto;

import java.util.UUID;

public record AttendanceDto(
        UUID id,
        String attendanceDate,
        String checkInTime,
        String checkOutTime,
        String attendanceType,
        String attendanceStatus,
        String checkInMethod,
        String checkOutMethod,
        Double workHours,
        Double faceConfidenceScore,
        String locationName,
        String checkInZoneName,
        String checkOutZoneName,
        Integer lateByMinutes,
        Integer overtimeMinutes,
        boolean manualEntry
) {}
