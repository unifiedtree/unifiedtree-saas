package com.unifiedtree.attendance.api;

import com.hrms.attendance.service.AttendanceCalendar.DayKind;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The alternate JDBC attendance service must label days exactly like the live one. */
class CanonicalAttendanceRulesTest {

    @Test
    void weeklySummaryLabelsMatchTheLiveService() {
        assertEquals("NOT_MARKED", CanonicalAttendanceService.weeklyStatus(DayKind.NOT_MARKED), "today with no punch");
        assertEquals("NOT_MARKED", CanonicalAttendanceService.weeklyStatus(DayKind.NOT_TRACKED), "before attendance started");
        assertEquals("UPCOMING", CanonicalAttendanceService.weeklyStatus(DayKind.UPCOMING));
        assertEquals("WEEKEND", CanonicalAttendanceService.weeklyStatus(DayKind.WEEKLY_OFF));
        assertEquals("HOLIDAY", CanonicalAttendanceService.weeklyStatus(DayKind.HOLIDAY));
        assertEquals("ON_LEAVE", CanonicalAttendanceService.weeklyStatus(DayKind.ON_LEAVE));
        assertEquals("ABSENT", CanonicalAttendanceService.weeklyStatus(DayKind.ABSENT));
    }

    @Test
    void averageArrivalUsesTheLiveTwelveHourFormat() {
        assertEquals("09:05 AM", CanonicalAttendanceService.averageArrival(9 * 60 + 5));
        assertEquals("12:30 PM", CanonicalAttendanceService.averageArrival(12 * 60 + 30));
        assertEquals("01:15 PM", CanonicalAttendanceService.averageArrival(13 * 60 + 15));
        assertEquals("12:10 AM", CanonicalAttendanceService.averageArrival(10));
    }
}
