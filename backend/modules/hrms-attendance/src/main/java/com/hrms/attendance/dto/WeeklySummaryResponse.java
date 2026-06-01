package com.hrms.attendance.dto;

import java.util.List;

public record WeeklySummaryResponse(
        double totalHours,
        double overtimeHours,
        int presentDays,
        String avgArrivalTime,
        List<WeeklyDayResponse> days
) {}
