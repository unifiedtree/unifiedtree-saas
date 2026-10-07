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

    @Test void onAPastDayALeaverIsOnTheRollThroughTheirLastWorkingDay() {
        // Regression 6 Oct (22 Sep 2026: Total employees 23, "of 35 scheduled"): the attendance roster
        // counts a leaver on their last working day, so the past day's headcount does too.
        var p = person(LocalDate.of(2024, 1, 1), "EXITED", MAR_14_2025);
        assertTrue(DashboardAsOf.employedThrough(p, MAR_14_2025), "their last working day counts");
        assertEquals(DashboardAsOf.workedOn(MAR_14_2025, MAR_14_2025), DashboardAsOf.employedThrough(p, MAR_14_2025));
        assertTrue(DashboardAsOf.employedThrough(p, LocalDate.of(2025, 3, 13)));
        assertFalse(DashboardAsOf.employedThrough(p, LocalDate.of(2025, 3, 15)), "the day after, they are gone");
        var terminated = new DashboardAsOf.Person(UUID.randomUUID(), LocalDate.of(2024, 1, 1), "TERMINATED", null, MAR_14_2025);
        assertTrue(DashboardAsOf.employedThrough(terminated, MAR_14_2025), "the termination date stands in for a missing last working day");
        var noDates = new DashboardAsOf.Person(UUID.randomUUID(), LocalDate.of(2024, 1, 1), "EXITED", null, null);
        assertFalse(DashboardAsOf.employedThrough(noDates, MAR_14_2025));
        assertFalse(DashboardAsOf.employedThrough(person(LocalDate.of(2025, 3, 15), "ACTIVE", null), MAR_14_2025), "not joined yet");
        assertFalse(DashboardAsOf.employedThrough(person(null, "ACTIVE", null), MAR_14_2025));

        var staying = person(LocalDate.of(2023, 3, 1), "ACTIVE", null);
        var lastDay = person(LocalDate.of(2023, 3, 1), "EXITED", MAR_14_2025);
        var leftBefore = person(LocalDate.of(2023, 3, 1), "RESIGNED", LocalDate.of(2025, 3, 13));
        List<DashboardAsOf.Person> people = List.of(staying, lastDay, leftBefore);
        // Through the last day: the person on their last day is on the roll (and, by their status, on notice).
        var past = DashboardAsOf.headcount(people, Map.of(), MAR_14_2025, true);
        assertEquals(2, past.total());
        assertEquals(1, past.active());
        assertEquals(1, past.onNotice());
        assertEquals(2, past.left(), "both still count as this month's leavers");
        // Today's rule is unchanged: the last working day counts as gone.
        assertEquals(1, DashboardAsOf.headcount(people, Map.of(), MAR_14_2025).total());
        assertEquals(1, DashboardAsOf.headcount(people, Map.of(), MAR_14_2025, false).total());
    }

    @Test void noJoiningDateCountsFromTheRecordsCreationOnAnyDay() {
        LocalDate created = LocalDate.of(2025, 3, 10);
        assertEquals(created, DashboardHistory.joinedOrCreated(null, created), "as the day's attendance roster");
        assertEquals(MAR_14_2025, DashboardHistory.joinedOrCreated(MAR_14_2025, created));
    }

    /**
     * Production, 7 Oct 2026: three people without a joining date were on the day's roster ("18 scheduled")
     * and on past days, but not in today's Total employees (15), and a range ending today counted fewer
     * joiners than a shorter one ending yesterday. With the record's creation day standing in for the
     * missing date, today, a past day and every range count them alike.
     */
    @Test void peopleWithoutAJoiningDateCountTheSameTodayOnAPastDayAndOverARange() {
        LocalDate today = LocalDate.of(2026, 10, 7), yesterday = today.minusDays(1), created = LocalDate.of(2026, 10, 2);
        var dated = person(LocalDate.of(2026, 1, 5), "ACTIVE", null);
        var undated = person(DashboardHistory.joinedOrCreated(null, created), "PROBATION", null);
        var undatedToo = person(DashboardHistory.joinedOrCreated(null, created), "ACTIVE", null);
        var people = List.of(dated, undated, undatedToo);

        var now = DashboardAsOf.headcount(people, Map.of(), today, false);
        var past = DashboardAsOf.headcount(people, Map.of(), yesterday, true);
        assertEquals(3, now.total(), "today's Total employees counts them");
        assertEquals(now.total(), past.total(), "as yesterday's does: nobody joined or left in between");
        assertEquals(2, now.active());
        assertEquals(1, now.probation());
        assertEquals(2, now.joined(), "this month's joiners: the two whose records were created on the 2nd");
        // A longer range never has fewer joiners than a shorter one inside it.
        int week = DashboardAsOf.moves(people, today.minusDays(6), today).joined();
        int threeDays = DashboardAsOf.moves(people, yesterday.minusDays(2), yesterday).joined();
        assertEquals(2, week);
        assertEquals(0, threeDays);
        assertTrue(week >= DashboardAsOf.moves(people, created, yesterday).joined());
        // Before the record existed they are not on the roll.
        assertEquals(1, DashboardAsOf.headcount(people, Map.of(), created.minusDays(1), true).total());
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

    @Test void joinersAndLeaversOfAPeriodCountBothEnds() {
        // The dashboard's date range 26 Feb – 3 Mar 2025, across a month end.
        LocalDate from = LocalDate.of(2025, 2, 26), to = LocalDate.of(2025, 3, 3);
        var before = person(LocalDate.of(2025, 2, 25), "ACTIVE", null);            // the day before: no
        var firstDay = person(from, "ACTIVE", null);                                // counts
        var lastDay = person(to, "PROBATION", null);                                // counts
        var after = person(LocalDate.of(2025, 3, 4), "ACTIVE", null);              // no
        var noDate = person(null, "ACTIVE", null);                                  // no joining date: no
        var leftOnFirst = person(LocalDate.of(2020, 1, 1), "EXITED", from);         // counts
        var leftOnLast = person(LocalDate.of(2020, 1, 1), "TERMINATED", to);        // counts
        var leftBefore = person(LocalDate.of(2020, 1, 1), "RESIGNED", LocalDate.of(2025, 2, 25));
        var onNotice = person(LocalDate.of(2020, 1, 1), "NOTICE_PERIOD", LocalDate.of(2025, 3, 1)); // not left yet
        var terminatedOnly = new DashboardAsOf.Person(UUID.randomUUID(), LocalDate.of(2020, 1, 1), "TERMINATED", null, LocalDate.of(2025, 3, 2));
        var m = DashboardAsOf.moves(List.of(before, firstDay, lastDay, after, noDate, leftOnFirst, leftOnLast, leftBefore, onNotice, terminatedOnly), from, to);
        assertEquals(2, m.joined());
        assertEquals(3, m.left());
        // One day is that day's joiners and leavers.
        var one = DashboardAsOf.moves(List.of(firstDay, leftOnFirst, lastDay), from, from);
        assertEquals(1, one.joined());
        assertEquals(1, one.left());
    }

    @Test void endOfADayIsMidnightIndiaTime() {
        assertEquals(Instant.parse("2025-03-14T18:30:00Z"), DashboardAsOf.endOf(MAR_14_2025));
        // Year boundary.
        assertEquals(Instant.parse("2025-12-31T18:30:00Z"), DashboardAsOf.endOf(LocalDate.of(2025, 12, 31)));
    }
}
