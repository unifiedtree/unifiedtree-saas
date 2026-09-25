package com.hrms.api.attendance;

import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.enums.AttendanceStatus;
import com.hrms.attendance.enums.AttendanceType;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The trend's per-day checked-in total (V143.25): someone who worked from home
 * and was also late or half-day is one person who came in, not two; and a day
 * that is everyone's weekly off is flagged so the calendar greys it out.
 */
class AttendanceTrendCountsTest {

    private static final LocalDate DAY = LocalDate.of(2026, 9, 22);

    private static AttendanceRecord row(AttendanceStatus status, AttendanceType type) {
        AttendanceRecord r = new AttendanceRecord();
        r.setEmployeeId(UUID.randomUUID());
        r.setAttendanceDate(DAY);
        r.setCheckInAt(Instant.parse("2026-09-22T04:00:00Z"));
        r.setAttendanceStatus(status);
        r.setAttendanceType(type);
        return r;
    }

    @Test void aLateHomeWorkerIsCountedOnceInCheckedIn() {
        var rows = List.of(
                row(AttendanceStatus.ON_TIME, AttendanceType.OFFICE),
                row(AttendanceStatus.LATE, AttendanceType.WFH),
                row(AttendanceStatus.HALF_DAY, AttendanceType.WFH),
                row(AttendanceStatus.ON_TIME, AttendanceType.WFH));
        var c = AttendanceController.dailyCounts(DAY, 5, 0, rows, Set.of());

        assertEquals(4, c.checkedIn());
        assertEquals(1, c.workFromHomeOnTime());
        // The old fields still overlap (WFH includes the late and half-day ones)...
        assertEquals(3, c.workFromHome());
        assertEquals(c.present() + c.late() + c.halfDay() + c.workFromHome(), 6);
        // ...the new ones add up to the people who came in.
        assertEquals(c.checkedIn(), c.present() + c.late() + c.halfDay() + c.workFromHomeOnTime());
        assertEquals(1, c.notMarked());
        assertEquals(5, c.scheduled());
        assertFalse(c.weeklyOffDay());
    }

    @Test void aPersonWithTwoRowsThatDayIsStillOnePerson() {
        AttendanceRecord first = row(AttendanceStatus.ON_TIME, AttendanceType.OFFICE);
        AttendanceRecord second = row(AttendanceStatus.ON_TIME, AttendanceType.OFFICE);
        second.setEmployeeId(first.getEmployeeId());
        assertEquals(1, AttendanceController.dailyCounts(DAY, 3, 0, List.of(first, second), Set.of()).checkedIn());
    }

    @Test void aDayThatIsEveryonesWeeklyOffIsFlagged() {
        var sunday = AttendanceController.dailyCounts(DAY, 0, 7, List.of(row(AttendanceStatus.ON_TIME, AttendanceType.OFFICE)), Set.of());
        assertTrue(sunday.weeklyOffDay());
        assertEquals(7, sunday.weeklyOff());
        assertEquals(1, sunday.checkedIn(), "someone who still came in on the off day is shown");

        // A 6-day-week team: Saturday is off for some, a working day for the rest.
        var saturday = AttendanceController.dailyCounts(DAY, 4, 3, List.of(), Set.of());
        assertFalse(saturday.weeklyOffDay());
        // Nobody in scope at all (a manager with no team) is not a weekly off.
        assertFalse(AttendanceController.dailyCounts(DAY, 0, 0, List.of(), Set.of()).weeklyOffDay());
    }
}
