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
        int teamPresentToday,
        String scheduledStart,
        Integer graceMinutes
) {
    public AttendanceHomeResponse(String employeeName,
                                  String jobTitle,
                                  boolean punchedIn,
                                  AttendanceDto todayRecord,
                                  MonthlyStatsResponse monthlySummary,
                                  String locationLabel,
                                  boolean withinZone,
                                  int pendingApprovals,
                                  int teamPresentToday) {
        this(employeeName, jobTitle, punchedIn, todayRecord, monthlySummary,
                locationLabel, withinZone, pendingApprovals, teamPresentToday, null, null);
    }
}
