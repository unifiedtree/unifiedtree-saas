package com.hrms.attendance.dto;

public record AttendanceHomeResponse(
        String employeeName,
        String jobTitle,
        boolean punchedIn,
        AttendanceDto todayRecord,
        MonthlyStatsResponse monthlySummary,
        String locationLabel,
        boolean withinZone,
        int pendingApprovals,
        int teamPresentToday
) {
}
