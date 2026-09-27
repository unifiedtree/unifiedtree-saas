package com.hrms.attendance.dto;

public record MonthlyStatsResponse(
        int presentDays,
        int absentDays,
        int holidays,
        int onTimeDays,
        int lateDays,
        int attendanceScore,
        /**
         * Days on approved leave so far this month (up to today), V143.53
         * redesign (BW-15). Additive; null where it isn't counted.
         */
        Integer leaveDays
) {
    public MonthlyStatsResponse(int presentDays, int absentDays, int holidays, int onTimeDays, int lateDays,
                                int attendanceScore) {
        this(presentDays, absentDays, holidays, onTimeDays, lateDays, attendanceScore, null);
    }
}
