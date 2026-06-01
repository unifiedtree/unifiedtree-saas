package com.hrms.attendance.dto;

public record WeeklyDayResponse(
        String date,
        double hours,
        String status
) {}
