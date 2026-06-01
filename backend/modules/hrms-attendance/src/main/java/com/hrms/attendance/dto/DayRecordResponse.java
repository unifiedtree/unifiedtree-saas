package com.hrms.attendance.dto;

public record DayRecordResponse(
        String date,
        String status,
        String checkInTime,
        String checkOutTime,
        Double workHours
) {}
