package com.hrms.attendance.dto;

public record MonthlyStatsResponse(
        int presentDays,
        int absentDays,
        int holidays,
        int onTimeDays,
        int lateDays,
        int attendanceScore
) {}
