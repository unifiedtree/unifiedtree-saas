package com.hrms.attendance.dto;

import java.util.List;

public record WeeklySummaryResponse(
        double totalHours,
        double overtimeHours,
        int presentDays,
        String avgArrivalTime,
        Double dailyTargetHours,
        List<WeeklyDayResponse> days
) {
    public WeeklySummaryResponse(double totalHours,
                                 double overtimeHours,
                                 int presentDays,
                                 String avgArrivalTime,
                                 List<WeeklyDayResponse> days) {
        this(totalHours, overtimeHours, presentDays, avgArrivalTime, null, days);
    }
}
