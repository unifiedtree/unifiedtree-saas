package com.hrms.attendance.service;

import com.hrms.attendance.service.AttendanceCalendar.DayKind;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AttendanceCalendarTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 25); // a Friday
    private static final LocalDate START = LocalDate.of(2026, 9, 1);

    @Test
    void weeklyOffsComeFromThePersonThenTheCompanyThenSatSun() {
        assertEquals(Set.of(7), AttendanceCalendar.pickOffDays("7", "5,6"), "own days win");
        assertEquals(Set.of(5, 6), AttendanceCalendar.pickOffDays(null, "5,6"), "company days when the person has none");
        assertEquals(Set.of(5, 6), AttendanceCalendar.pickOffDays(" ", "5,6"));
        assertEquals(Set.of(6, 7), AttendanceCalendar.pickOffDays(null, null), "Saturday and Sunday when neither is set");
        assertEquals(Set.of(6, 7), AttendanceCalendar.pickOffDays("junk,9", ""), "junk falls through");
    }

    @Test
    void parsingSkipsJunkAndOutOfRangeDays() {
        assertEquals(Set.of(1, 7), AttendanceCalendar.parseOffDays(" 1, x, 7 ,0,8"));
        assertTrue(AttendanceCalendar.parseOffDays(null).isEmpty());
    }

    @Test
    void todayWithoutAPunchIsNotMarkedNotAbsent() {
        assertEquals(DayKind.NOT_MARKED, AttendanceCalendar.classify(TODAY, TODAY, START, false, false, false, false));
        assertEquals(DayKind.ABSENT, AttendanceCalendar.classify(TODAY.minusDays(1), TODAY, START, false, false, false, false));
    }

    @Test
    void weeklyOffsHolidaysLeaveAndFutureAreNeverAbsences() {
        assertEquals(DayKind.WEEKLY_OFF, AttendanceCalendar.classify(TODAY.minusDays(1), TODAY, START, true, false, false, false));
        assertEquals(DayKind.WEEKLY_OFF, AttendanceCalendar.classify(TODAY.minusDays(1), TODAY, START, true, true, false, false),
                "a punch on a weekly off is still the weekly off (its hours are shown)");
        assertEquals(DayKind.HOLIDAY, AttendanceCalendar.classify(TODAY.minusDays(2), TODAY, START, false, false, true, false));
        assertEquals(DayKind.ON_LEAVE, AttendanceCalendar.classify(TODAY.minusDays(2), TODAY, START, false, false, false, true));
        assertEquals(DayKind.UPCOMING, AttendanceCalendar.classify(TODAY.plusDays(1), TODAY, START, false, false, false, false));
        assertEquals(DayKind.PUNCHED, AttendanceCalendar.classify(TODAY.minusDays(2), TODAY, START, false, true, true, false),
                "a punch on a holiday counts as present");
    }

    @Test
    void daysBeforeAttendanceStartedAreNotTracked() {
        assertEquals(DayKind.NOT_TRACKED, AttendanceCalendar.classify(START.minusDays(1), TODAY, START, false, false, false, false));
    }

    @Test
    void attendanceStartsAtTheLaterOfJoiningAndTheFirstPunch() {
        LocalDate joined = LocalDate.of(2026, 9, 10);
        LocalDate firstPunch = LocalDate.of(2026, 9, 3);
        assertEquals(joined, AttendanceCalendar.attendanceStart(joined, firstPunch, TODAY));
        assertEquals(firstPunch, AttendanceCalendar.attendanceStart(LocalDate.of(2020, 1, 1), firstPunch, TODAY));
        assertEquals(TODAY, AttendanceCalendar.attendanceStart(joined, null, TODAY), "never punched: nothing before today");
    }

    @Test
    void lookupsWithoutADatabaseFallBackSafely() {
        assertEquals(Set.of(6, 7), AttendanceCalendar.weeklyOffDays(null, java.util.UUID.randomUUID()));
        assertTrue(AttendanceCalendar.holidayDates(null, java.util.UUID.randomUUID(), START, TODAY).isEmpty());
        assertEquals(TODAY, AttendanceCalendar.attendanceStart(null, java.util.UUID.randomUUID(), TODAY));
    }
}
