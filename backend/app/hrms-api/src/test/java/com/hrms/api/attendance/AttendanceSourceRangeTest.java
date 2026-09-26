package com.hrms.api.attendance;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GET /dashboard/sources: one day by default (as before), a whole range when
 * Attendance Analytics asks for a past month with from + to.
 */
class AttendanceSourceRangeTest {

    private static final LocalDate DAY = LocalDate.of(2026, 9, 26);

    @Test void withoutARangeItIsTheDay() {
        assertArrayEquals(new LocalDate[] { DAY, DAY }, AttendanceController.sourceRange(DAY, null, null));
        // Half a range is ignored: the old single-day behaviour stays.
        assertArrayEquals(new LocalDate[] { DAY, DAY }, AttendanceController.sourceRange(DAY, LocalDate.of(2025, 3, 1), null));
        assertArrayEquals(new LocalDate[] { DAY, DAY }, AttendanceController.sourceRange(DAY, null, LocalDate.of(2025, 3, 31)));
    }

    @Test void aMonthIsCountedWhole() {
        LocalDate from = LocalDate.of(2025, 3, 1), to = LocalDate.of(2025, 3, 31);
        assertArrayEquals(new LocalDate[] { from, to }, AttendanceController.sourceRange(DAY, from, to));
        // Reversed ends are swapped.
        assertArrayEquals(new LocalDate[] { from, to }, AttendanceController.sourceRange(DAY, to, from));
    }

    @Test void longRangesAreClampedToTheLast31Days() {
        LocalDate[] r = AttendanceController.sourceRange(DAY, LocalDate.of(2024, 1, 1), LocalDate.of(2025, 3, 31));
        assertEquals(LocalDate.of(2025, 3, 1), r[0]);
        assertEquals(LocalDate.of(2025, 3, 31), r[1]);
    }
}
