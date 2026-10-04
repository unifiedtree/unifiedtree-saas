package com.hrms.api.workforce;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BW-90: the Workforce figures. Each case is small enough to count by hand; the
 * attrition case is worked out with the attrition report's SQL formula
 * (exits over the average of opening and closing headcount).
 */
class EmployeeStatsTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 27);

    private static EmployeeStats.Person p(String status, LocalDate joined) {
        return new EmployeeStats.Person(UUID.randomUUID(), status, joined, null, null, null, null);
    }

    private static EmployeeStats.Person leaver(String status, LocalDate joined, LocalDate lastDay) {
        return new EmployeeStats.Person(UUID.randomUUID(), status, joined, lastDay, null, null, null);
    }

    @Test
    void countsEveryStatusAndTheTotal() {
        List<EmployeeStats.Person> people = List.of(
                p("ACTIVE", TODAY.minusYears(2)), p("ACTIVE", TODAY.minusYears(1)),
                p("PROBATION", TODAY.minusMonths(2)), p("NOTICE_PERIOD", TODAY.minusYears(3)),
                p("SUSPENDED", TODAY.minusYears(1)), leaver("EXITED", TODAY.minusYears(1), TODAY.minusMonths(1)),
                leaver("TERMINATED", TODAY.minusYears(1), TODAY.minusMonths(2)), p("SOMETHING_ELSE", null));
        EmployeeStats.Response r = EmployeeStats.compute(people, TODAY, false, Map.of());
        assertThat(r.counts()).isEqualTo(new EmployeeStats.Counts(8, 2, 1, 1, 1, 1, 1));
    }

    @Test
    void joinersAndLeaversOfThisMonthUpToToday() {
        List<EmployeeStats.Person> people = List.of(
                p("PROBATION", TODAY.withDayOfMonth(1)),          // joined this month
                p("PROBATION", TODAY),                             // joined today
                p("PROBATION", TODAY.plusDays(2)),                 // joins later this month: not yet
                p("ACTIVE", TODAY.minusMonths(1)),                 // last month
                leaver("EXITED", TODAY.minusYears(1), TODAY.minusDays(3)),
                leaver("TERMINATED", TODAY.minusYears(1), TODAY.withDayOfMonth(1)),
                leaver("EXITED", TODAY.minusYears(1), TODAY.minusMonths(1)),
                // on notice with a last working day this month has not left
                new EmployeeStats.Person(UUID.randomUUID(), "NOTICE_PERIOD", TODAY.minusYears(1), TODAY.minusDays(1), null, TODAY.minusDays(20), null));
        EmployeeStats.Response r = EmployeeStats.compute(people, TODAY, false, Map.of());
        assertThat(r.joinedThisMonth()).isEqualTo(2);
        assertThat(r.leftThisMonth()).isEqualTo(2);
    }

    @Test
    void terminationDateCountsWhenThereIsNoLastWorkingDay() {
        var p = new EmployeeStats.Person(UUID.randomUUID(), "TERMINATED", TODAY.minusYears(1), null, TODAY.minusDays(1), null, null);
        EmployeeStats.Response r = EmployeeStats.compute(List.of(p), TODAY, false, Map.of());
        assertThat(r.leftThisMonth()).isEqualTo(1);
        assertThat(r.exitedThisYear()).isEqualTo(1);
        assertThat(r.terminatedThisYear()).isEqualTo(1);
    }

    @Test
    void noticesOfTheLastSevenDaysIncludingToday() {
        List<EmployeeStats.Person> people = new ArrayList<>();
        for (int back : new int[]{0, 3, 6, 7, 30}) {
            people.add(new EmployeeStats.Person(UUID.randomUUID(), "NOTICE_PERIOD", TODAY.minusYears(1), null, null, TODAY.minusDays(back), null));
        }
        assertThat(EmployeeStats.compute(people, TODAY, false, Map.of()).noticeStartedLast7Days()).isEqualTo(3);
    }

    @Test
    void probationReviewsDueNextCalendarMonthOnlyForPeopleOnProbation() {
        List<EmployeeStats.Person> people = List.of(
                new EmployeeStats.Person(UUID.randomUUID(), "PROBATION", TODAY.minusMonths(5), null, null, null, LocalDate.of(2026, 10, 1)),
                new EmployeeStats.Person(UUID.randomUUID(), "PROBATION", TODAY.minusMonths(5), null, null, null, LocalDate.of(2026, 10, 31)),
                new EmployeeStats.Person(UUID.randomUUID(), "PROBATION", TODAY.minusMonths(5), null, null, null, LocalDate.of(2026, 9, 30)),
                new EmployeeStats.Person(UUID.randomUUID(), "PROBATION", TODAY.minusMonths(5), null, null, null, LocalDate.of(2026, 11, 1)),
                new EmployeeStats.Person(UUID.randomUUID(), "ACTIVE", TODAY.minusMonths(5), null, null, null, LocalDate.of(2026, 10, 15)));
        assertThat(EmployeeStats.compute(people, TODAY, false, Map.of()).probationReviewsDueNextMonth()).isEqualTo(2);
    }

    @Test
    void exitsThisYearAreExitedOrTerminatedWithALastDayThisYear() {
        List<EmployeeStats.Person> people = List.of(
                leaver("EXITED", TODAY.minusYears(3), LocalDate.of(2026, 1, 1)),
                leaver("TERMINATED", TODAY.minusYears(3), LocalDate.of(2026, 6, 30)),
                leaver("EXITED", TODAY.minusYears(3), LocalDate.of(2025, 12, 31)),
                leaver("EXITED", TODAY.minusYears(3), null),
                // on notice: not an exit yet
                new EmployeeStats.Person(UUID.randomUUID(), "NOTICE_PERIOD", TODAY.minusYears(3), LocalDate.of(2026, 10, 10), null, TODAY, null));
        assertThat(EmployeeStats.compute(people, TODAY, false, Map.of()).exitedThisYear()).isEqualTo(2);
    }

    @Test
    void terminatedThisYearIsTheTerminatedShareOfTheSameYearsExits() {
        List<EmployeeStats.Person> people = List.of(
                leaver("EXITED", TODAY.minusYears(3), LocalDate.of(2026, 2, 1)),
                leaver("EXITED", TODAY.minusYears(3), LocalDate.of(2026, 8, 31)),
                leaver("TERMINATED", TODAY.minusYears(3), LocalDate.of(2026, 6, 30)),
                // terminated last year: in the all-time count, not this year's
                leaver("TERMINATED", TODAY.minusYears(3), LocalDate.of(2025, 12, 31)),
                // terminated with no last working day: dated by the termination date
                new EmployeeStats.Person(UUID.randomUUID(), "TERMINATED", TODAY.minusYears(3), null, LocalDate.of(2026, 3, 15), null, null),
                // terminated with no date at all: not counted for any year
                leaver("TERMINATED", TODAY.minusYears(3), null),
                // resigned but not yet marked exited: not on the exit tab
                leaver("RESIGNED", TODAY.minusYears(3), LocalDate.of(2026, 9, 1)));
        EmployeeStats.Response r = EmployeeStats.compute(people, TODAY, false, Map.of());
        assertThat(r.exitedThisYear()).isEqualTo(4);
        assertThat(r.terminatedThisYear()).isEqualTo(2);
        assertThat(r.counts().terminated()).isEqualTo(4);
        // resigned or left this year = exitedThisYear - terminatedThisYear, the two EXITED people
        assertThat(r.exitedThisYear() - r.terminatedThisYear()).isEqualTo(2);
    }

    @Test
    void attritionFollowsTheReportFormulaAndNeedsThePermission() {
        // Opening on 1 Jan: a, b, c, d (4). Closing today: a, b, e (3): c and d left this year, e joined.
        List<EmployeeStats.Person> people = List.of(
                p("ACTIVE", LocalDate.of(2020, 1, 1)),
                p("ACTIVE", LocalDate.of(2025, 12, 31)),
                leaver("EXITED", LocalDate.of(2021, 5, 1), LocalDate.of(2026, 3, 31)),
                leaver("TERMINATED", LocalDate.of(2022, 5, 1), LocalDate.of(2026, 7, 15)),
                p("PROBATION", LocalDate.of(2026, 8, 1)),
                leaver("EXITED", LocalDate.of(2019, 1, 1), LocalDate.of(2025, 11, 30)));   // left last year: neither
        // exits 2 / ((4 + 3) / 2) * 100 = 57.14
        assertThat(EmployeeStats.compute(people, TODAY, true, Map.of()).attritionPercent()).isEqualByComparingTo(new BigDecimal("57.14"));
        assertThat(EmployeeStats.compute(people, TODAY, false, Map.of()).attritionPercent()).isNull();
        assertThat(EmployeeStats.compute(List.of(), TODAY, true, Map.of()).attritionPercent()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    void seriesIsSevenMonthEndsThenTodayOnTheRoll() {
        assertThat(EmployeeStats.seriesDates(TODAY)).containsExactly(
                LocalDate.of(2026, 3, 31), LocalDate.of(2026, 4, 30), LocalDate.of(2026, 5, 31),
                LocalDate.of(2026, 6, 30), LocalDate.of(2026, 7, 31), LocalDate.of(2026, 8, 31), TODAY);
        List<EmployeeStats.Person> people = List.of(
                p("ACTIVE", LocalDate.of(2020, 1, 1)),                                   // every point
                p("PROBATION", LocalDate.of(2026, 7, 31)),                               // from 31 Jul
                leaver("EXITED", LocalDate.of(2020, 1, 1), LocalDate.of(2026, 5, 31)),   // gone from 31 May (last day counts as gone)
                p("PROBATION", LocalDate.of(2026, 10, 5)),                               // future joiner: never
                p("SUSPENDED", LocalDate.of(2026, 4, 1)),                                // on the roll from 30 Apr
                p("ACTIVE", null));                                                      // no joining date: never
        EmployeeStats.Response r = EmployeeStats.compute(people, TODAY, false, Map.of());
        assertThat(r.activeSeries()).extracting(EmployeeStats.SeriesPoint::active).containsExactly(2L, 3L, 2L, 2L, 3L, 3L, 3L);
        assertThat(r.activeSeries().get(6).date()).isEqualTo(TODAY);
    }

    @Test
    void suspendedPeopleCarryWhenTheirSuspensionBegan() {
        var withHistory = p("SUSPENDED", TODAY.minusYears(1));
        var withoutHistory = p("SUSPENDED", TODAY.minusYears(1));
        EmployeeStats.Response r = EmployeeStats.compute(List.of(withHistory, withoutHistory, p("ACTIVE", TODAY.minusYears(1))),
                TODAY, false, Map.of(withHistory.id(), LocalDate.of(2026, 9, 1)));
        assertThat(r.suspendedSince()).containsExactly(
                new EmployeeStats.SuspendedSince(withHistory.id(), LocalDate.of(2026, 9, 1)),
                new EmployeeStats.SuspendedSince(withoutHistory.id(), null));
    }

    @Test
    void emptyWorkspace() {
        EmployeeStats.Response r = EmployeeStats.compute(List.of(), TODAY, false, null);
        assertThat(r.counts().total()).isZero();
        assertThat(r.terminatedThisYear()).isZero();
        assertThat(r.activeSeries()).hasSize(7).allMatch(pt -> pt.active() == 0);
        assertThat(r.suspendedSince()).isEmpty();
    }
}
