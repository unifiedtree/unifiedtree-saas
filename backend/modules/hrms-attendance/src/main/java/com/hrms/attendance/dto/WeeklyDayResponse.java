package com.hrms.attendance.dto;

public record WeeklyDayResponse(
        String date,
        double hours,
        String status,
        String checkInTime,
        String checkOutTime,
        Integer lateByMinutes
) {
    public WeeklyDayResponse(String date, double hours, String status) {
        this(date, hours, status, null, null, null);
    }
}
