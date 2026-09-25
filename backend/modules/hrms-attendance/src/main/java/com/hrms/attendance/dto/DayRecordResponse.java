package com.hrms.attendance.dto;

public record DayRecordResponse(
        String date,
        String status,
        String checkInTime,
        String checkOutTime,
        Double workHours,
        /** Why the day has this status (attendance policy or a reviewer's change); null when plain. */
        String note,
        /** True when a reviewer set or excused this day by hand. */
        boolean manual
) {
    public DayRecordResponse(String date, String status, String checkInTime, String checkOutTime, Double workHours) {
        this(date, status, checkInTime, checkOutTime, workHours, null, false);
    }
}
