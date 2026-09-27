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
        boolean manual,
        // ── Day details (V143.53 redesign, BW-15). Additive: every field above
        // keeps its meaning, and these are null on days without a punch.
        /** OFFICE / WFH / FIELD_WORK …: how the day was worked. */
        String attendanceType,
        /** Minutes after the start time, set only when the arrival was past the grace. */
        Integer lateMinutes,
        /** How the check-in was made (FACE_RECOGNITION, GPS, WEB, MANAGER_OVERRIDE …). */
        String checkInMethod,
        String checkOutMethod,
        /** Where the check-in was made (branch, zone or the place the app reported). */
        String locationName,
        /** True when the day's times were fixed: an approved fix request or an entry by HR. */
        Boolean regularized
) {
    public DayRecordResponse(String date, String status, String checkInTime, String checkOutTime, Double workHours) {
        this(date, status, checkInTime, checkOutTime, workHours, null, false);
    }

    public DayRecordResponse(String date, String status, String checkInTime, String checkOutTime, Double workHours,
                             String note, boolean manual) {
        this(date, status, checkInTime, checkOutTime, workHours, note, manual, null, null, null, null, null, null);
    }
}
