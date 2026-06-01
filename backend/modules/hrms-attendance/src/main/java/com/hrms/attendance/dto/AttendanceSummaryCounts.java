package com.hrms.attendance.dto;

public record AttendanceSummaryCounts(
        long present,
        long onLeave,
        long late,
        long halfDay,
        long earlyCheckout,
        long workFromHome,
        long notMarked,
        long absent
) {
}
