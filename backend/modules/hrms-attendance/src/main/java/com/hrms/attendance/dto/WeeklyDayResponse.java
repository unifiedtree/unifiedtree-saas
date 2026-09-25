package com.hrms.attendance.dto;

public record WeeklyDayResponse(
        String date,
        double hours,
        String status,
        String checkInTime,
        String checkOutTime,
        Integer lateByMinutes,
        /** Why the day has this status (attendance policy or a reviewer's change); null when plain. */
        String note,
        /** True when a reviewer set or excused this day by hand. */
        boolean manual
) {
    public WeeklyDayResponse(String date, double hours, String status) {
        this(date, hours, status, null, null, null, null, false);
    }

    public WeeklyDayResponse(String date, double hours, String status,
                             String checkInTime, String checkOutTime, Integer lateByMinutes) {
        this(date, hours, status, checkInTime, checkOutTime, lateByMinutes, null, false);
    }
}
