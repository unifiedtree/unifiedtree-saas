package com.hrms.api.workforce;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The admin dashboard's history view: who was on the roll, in which status, and
 * who joined or left, on a past date (the rules of the headcount report).
 */
class DashboardAsOfTest {

    private static final LocalDate MAR_14_2025 = LocalDate.of(2025, 3, 14);

    private static DashboardAsOf.Person person(LocalDate joined, String status, LocalDate lastDay) {
        return new DashboardAsOf.Person(UUID.randomUUID(), joined, status, lastDay, null);
    }

    private static DashboardAsOf.Change change(DashboardAsOf.Person p, String status, LocalDate on, String recorded) {
        return new DashboardAsOf.Change(p.id(), status, on, Instant.parse(recorded));
    }

    @Test void countsOnlyPeopleWhoHadJoinedAndNotYetLeft() {
        var veteran = person(LocalDate.of(2023, 3, 1), "ACTIVE", null);
        var laterHire = person(LocalDate.of(2025, 6, 1), "ACTIVE", null);          // joined after the date
        var leftBefore = person(LocalDate.of(2023, 1, 1), "EXITED", LocalDate.of(2024, 12, 31));
        var leftAfter = person(LocalDate.of(2024, 1, 1), "EXITED", LocalDate.of(2026, 9, 22)); // still there then
        var h = DashboardAsOf.headcount(List.of(veteran, laterHire, leftBefore, leftAfter), Map.of(), MAR_14_2025);
        assertEquals(2, h.total());
        // No history rows: the current status stands in, so the since-exited person counts as "on notice".
        assertEquals(1, h.active());
        assertEquals(1, h.onNotice());
    }

    @Test void aDateBeforeSomeoneJoinedLeavesThemOut() {
        var p = person(LocalDate.of(2025, 3, 15), "ACTIVE", null);
        assertFalse(DashboardAsOf.onRoll(p, MAR_14_2025));
        assertTrue(DashboardAsOf.onRoll(p, LocalDate.of(2025, 3, 15)), "the joining day itself counts");
        var noJoiningDate = person(null, "ACTIVE", null);
        assertFalse(DashboardAsOf.onRoll(noJoiningDate, MAR_14_2025));
    }

    @Test void aLeaverIsGoneFromTheirLastWorkingDayButStillWorkedIt() {
        var p = person(LocalDate.of(2024, 1, 1), "TERMINATED", MAR_14_2025);
        assertTrue(DashboardAsOf.onRoll(p, LocalDate.of(2025, 3, 13)));
        assertFalse(DashboardAsOf.onRoll(p, MAR_14_2025), "headcount report: a last working day on or before the date counts as gone");
        assertFalse(DashboardAsOf.onRoll(p, LocalDate.of(2025, 3, 20)));
        // Attendance: they are still expected at work on their last day, not the day after.
        assertTrue(DashboardAsOf.workedOn(MAR_14_2025, MAR_14_2025));
        assertFalse(DashboardAsOf.workedOn(MAR_14_2025, LocalDate.of(2025, 3, 15)));
        assertTrue(DashboardAsOf.workedOn(null, LocalDate.of(2030, 1, 1)), "people who haven't left always count");
    }

    @Test void aLeaverWithNoRecordedDatesCountsAsGone() {
        var p = new DashboardAsOf.Person(UUID.randomUUID(), LocalDate.of(2024, 1, 1), "EXITED", null, null);
        assertFalse(DashboardAsOf.onRoll(p, MAR_14_2025));
        var terminated = new DashboardAsOf.Person(UUID.randomUUID(), LocalDate.of(2024, 1, 1), "TERMINATED", null, LocalDate.of(2025, 4, 1));
        assertTrue(DashboardAsOf.onRoll(terminated, MAR_14_2025), "the termination date stands in for a missing last working day");
    }

    @Test void statusComesFromTheHistoryInForceOnTheDate() {
        var p = person(LocalDate.of(2025, 1, 1), "ACTIVE", null);
        var history = List.of(
                change(p, "PROBATION", LocalDate.of(2025, 1, 1), "2025-01-01T05:00:00Z"),
                change(p, "ACTIVE", LocalDate.of(2025, 7, 1), "2025-07-01T05:00:00Z"));
        assertEquals("PROBATION", DashboardAsOf.statusOn(p, history, MAR_14_2025));
        assertEquals("ACTIVE", DashboardAsOf.statusOn(p, history, LocalDate.of(2025, 7, 1)));
        var h = DashboardAsOf.headcount(List.of(p), Map.of(p.id(), history), MAR_14_2025);
        assertEquals(1, h.total());
        assertEquals(0, h.active());
        assertEquals(1, h.probation());
    }

    @Test void anExitRecordedBeforeItTakesEffectMeansOnNotice() {
        var p = person(LocalDate.of(2024, 1, 1), "EXITED", LocalDate.of(2025, 3, 31));
        var history = List.of(
                change(p, "ACTIVE", LocalDate.of(2024, 1, 1), "2024-01-01T05:00:00Z"),
                // Recorded on 10 Mar (IST), effective 31 Mar.
                change(p, "EXITED", LocalDate.of(2025, 3, 31), "2025-03-10T06:00:00Z"));
        assertEquals("ACTIVE", DashboardAsOf.statusOn(p, history, LocalDate.of(2025, 3, 9)));
        assertEquals("NOTICE_PERIOD", DashboardAsOf.statusOn(p, history, MAR_14_2025));
        var h = DashboardAsOf.headcount(List.of(p), Map.of(p.id(), history), MAR_14_2025);
        assertEquals(1, h.onNotice());
        assertEquals(0, h.active());
    }

    @Test void sameDayChangesFollowTheLaterRecord() {
        var p = person(LocalDate.of(2025, 3, 14), "EXITED", LocalDate.of(2025, 3, 20));
        var history = List.of(
                change(p, "EXITED", MAR_14_2025, "2025-03-14T10:00:00Z"),
                change(p, "ACTIVE", MAR_14_2025, "2025-03-14T09:00:00Z"));
        assertEquals("EXITED", DashboardAsOf.statusOn(p, history, MAR_14_2025));
    }

    @Test void joinersAndLeaversCountFromTheFirstOfTheMonthToTheDate() {
        var lastDayOfFeb = person(LocalDate.of(2025, 2, 28), "ACTIVE", null);     // previous month
        var firstOfMarch = person(LocalDate.of(2025, 3, 1), "ACTIVE", null);      // counts
        var onTheDate = person(MAR_14_2025, "ACTIVE", null);                      // counts
        var afterTheDate = person(LocalDate.of(2025, 3, 15), "ACTIVE", null);     // not yet
        var leftFeb = person(LocalDate.of(2020, 1, 1), "EXITED", LocalDate.of(2025, 2, 28));
        var leftMarch = person(LocalDate.of(2020, 1, 1), "RESIGNED", LocalDate.of(2025, 3, 1));
        var leftLater = person(LocalDate.of(2020, 1, 1), "EXITED", LocalDate.of(2025, 3, 31));
        var h = DashboardAsOf.headcount(List.of(lastDayOfFeb, firstOfMarch, onTheDate, afterTheDate, leftFeb, leftMarch, leftLater),
                Map.of(), MAR_14_2025);
        assertEquals(2, h.joined());
        assertEquals(1, h.left());
        // A month's last day covers the whole month.
        var whole = DashboardAsOf.headcount(List.of(firstOfMarch, onTheDate, afterTheDate, leftMarch, leftLater), Map.of(), LocalDate.of(2025, 3, 31));
        assertEquals(3, whole.joined());
        assertEquals(2, whole.left());
    }

    @Test void endOfADayIsMidnightIndiaTime() {
        assertEquals(Instant.parse("2025-03-14T18:30:00Z"), DashboardAsOf.endOf(MAR_14_2025));
        // Year boundary.
        assertEquals(Instant.parse("2025-12-31T18:30:00Z"), DashboardAsOf.endOf(LocalDate.of(2025, 12, 31)));
    }
}
