package com.hrms.app.reports;

import com.hrms.app.reports.ReportPeriods.Frequency;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Dates of scheduled report emails, and the report registry's permission rules. */
class ReportPeriodsTest {

    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");

    @Test
    void weeklyRunsOnTheNextMatchingWeekdayStrictlyAfter() {
        LocalDate thu = LocalDate.of(2026, 9, 24); // a Thursday
        assertThat(ReportPeriods.nextRun(Frequency.WEEKLY, 1, null, thu)).isEqualTo(LocalDate.of(2026, 9, 28)); // Monday
        assertThat(ReportPeriods.nextRun(Frequency.WEEKLY, 5, null, thu)).isEqualTo(LocalDate.of(2026, 9, 25)); // Friday, tomorrow
        // Same weekday as today: next week, never today.
        assertThat(ReportPeriods.nextRun(Frequency.WEEKLY, 4, null, thu)).isEqualTo(LocalDate.of(2026, 10, 1));
    }

    @Test
    void monthlyRunsOnTheDayThisMonthOrNext() {
        LocalDate d = LocalDate.of(2026, 9, 25);
        assertThat(ReportPeriods.nextRun(Frequency.MONTHLY, null, 28, d)).isEqualTo(LocalDate.of(2026, 9, 28));
        assertThat(ReportPeriods.nextRun(Frequency.MONTHLY, null, 25, d)).isEqualTo(LocalDate.of(2026, 10, 25));
        assertThat(ReportPeriods.nextRun(Frequency.MONTHLY, null, 1, d)).isEqualTo(LocalDate.of(2026, 10, 1));
        // Across a year end.
        assertThat(ReportPeriods.nextRun(Frequency.MONTHLY, null, 5, LocalDate.of(2026, 12, 20))).isEqualTo(LocalDate.of(2027, 1, 5));
        // Days past 28 are clamped so February always has the email.
        assertThat(ReportPeriods.nextRun(Frequency.MONTHLY, null, 31, LocalDate.of(2027, 1, 30))).isEqualTo(LocalDate.of(2027, 2, 28));
    }

    @Test
    void weeklyCoversTheSevenDaysBeforeAndMonthlyThePreviousMonth() {
        ReportPeriods.Period w = ReportPeriods.periodFor(Frequency.WEEKLY, LocalDate.of(2026, 9, 28));
        assertThat(w.from()).isEqualTo(LocalDate.of(2026, 9, 21));
        assertThat(w.to()).isEqualTo(LocalDate.of(2026, 9, 27));

        ReportPeriods.Period m = ReportPeriods.periodFor(Frequency.MONTHLY, LocalDate.of(2026, 3, 1));
        assertThat(m.from()).isEqualTo(LocalDate.of(2026, 2, 1));
        assertThat(m.to()).isEqualTo(LocalDate.of(2026, 2, 28));
        assertThat(m.label()).isEqualTo("1 Feb 2026 – 28 Feb 2026");
    }

    @Test
    void dailyRunsTomorrowAndCoversYesterday() {
        LocalDate fri = LocalDate.of(2026, 10, 2);
        assertThat(ReportPeriods.nextRun(Frequency.DAILY, null, null, fri)).isEqualTo(LocalDate.of(2026, 10, 3));
        ReportPeriods.Period p = ReportPeriods.periodFor(Frequency.DAILY, fri);
        assertThat(p.from()).isEqualTo(LocalDate.of(2026, 10, 1));
        assertThat(p.to()).isEqualTo(LocalDate.of(2026, 10, 1));
        assertThat(p.label()).isEqualTo("1 Oct 2026");
    }

    @Test
    void weekdaysSkipTheWeekendAndMondayCoversFridayToSunday() {
        LocalDate fri = LocalDate.of(2026, 10, 2), sat = fri.plusDays(1), mon = fri.plusDays(3), tue = fri.plusDays(4);
        assertThat(ReportPeriods.nextRun(Frequency.WEEKDAYS, null, null, fri)).isEqualTo(mon);
        assertThat(ReportPeriods.nextRun(Frequency.WEEKDAYS, null, null, sat)).isEqualTo(mon);
        assertThat(ReportPeriods.nextRun(Frequency.WEEKDAYS, null, null, mon)).isEqualTo(tue);
        ReportPeriods.Period monday = ReportPeriods.periodFor(Frequency.WEEKDAYS, mon);
        assertThat(monday.from()).isEqualTo(fri);
        assertThat(monday.to()).isEqualTo(fri.plusDays(2));
        ReportPeriods.Period tuesday = ReportPeriods.periodFor(Frequency.WEEKDAYS, tue);
        assertThat(tuesday.from()).isEqualTo(mon);
        assertThat(tuesday.to()).isEqualTo(mon);
    }

    @Test
    void anEmailGoesOutOnlyOnItsDayAndFromItsHour() {
        LocalDate today = LocalDate.of(2026, 10, 2);
        // No send hour: the first run of the day (07:05), as before V143.62.
        assertThat(ReportPeriods.sendsNow(today, null, today, 7)).isTrue();
        // A send hour waits for that hour's run, then goes out (and on later runs if one was missed).
        assertThat(ReportPeriods.sendsNow(today, 11, today, 10)).isFalse();
        assertThat(ReportPeriods.sendsNow(today, 11, today, 11)).isTrue();
        assertThat(ReportPeriods.sendsNow(today, 11, today, 15)).isTrue();
        // Not due yet: never, whatever the hour.
        assertThat(ReportPeriods.sendsNow(today.plusDays(1), null, today, 23)).isFalse();
        assertThat(ReportPeriods.sendsNow(today.plusDays(1), 7, today, 23)).isFalse();
        // Missed on an earlier day: goes out on the next run, even before its hour.
        assertThat(ReportPeriods.sendsNow(today.minusDays(1), 22, today, 7)).isTrue();
    }

    @Test
    void frequencyWordsAndWhichNeedTheMigration() {
        assertThat(Frequency.DAILY.needsScheduleOptions()).isTrue();
        assertThat(Frequency.WEEKDAYS.needsScheduleOptions()).isTrue();
        assertThat(Frequency.WEEKLY.needsScheduleOptions()).isFalse();
        assertThat(Frequency.MONTHLY.needsScheduleOptions()).isFalse();
        assertThat(Frequency.WEEKDAYS.word()).isEqualTo("weekday");
        assertThat(Frequency.MONTHLY.word()).isEqualTo("monthly");
    }

    @Test
    void reportFiltersFollowThePeriod() {
        ReportPeriods.Period p = new ReportPeriods.Period(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31));
        ReportPdfService.Params head = ReportPeriods.params(ReportKind.HEADCOUNT, CO, p);
        assertThat(head.asOf()).isEqualTo(LocalDate.of(2026, 8, 31));
        ReportPdfService.Params attr = ReportPeriods.params(ReportKind.ATTRITION, CO, p);
        assertThat(attr.from()).isEqualTo(LocalDate.of(2025, 9, 1));
        assertThat(attr.to()).isEqualTo(LocalDate.of(2026, 8, 31));
        ReportPdfService.Params att = ReportPeriods.params(ReportKind.ATTENDANCE_SUMMARY, CO, p);
        assertThat(att.from()).isEqualTo(p.from());
        assertThat(att.to()).isEqualTo(p.to());
        assertThat(ReportPeriods.params(ReportKind.LEAVE_BALANCE, CO, p).year()).isEqualTo(2026);
        assertThat(ReportPeriods.params(ReportKind.WORKFORCE_ANALYTICS, CO, p).asOf()).isEqualTo(p.to());
    }

    @Test
    void reportKindsOpenOnlyWithTheirOwnPermission() {
        assertThat(ReportKind.fromKey("late-marks")).contains(ReportKind.LATE_MARKS);
        assertThat(ReportKind.fromKey(" Headcount ")).contains(ReportKind.HEADCOUNT);
        assertThat(ReportKind.fromKey("payroll")).isEmpty();
        assertThat(ReportKind.LATE_MARKS.openableWith(Set.of("hrms.report.attendance"))).isTrue();
        assertThat(ReportKind.DIVERSITY.openableWith(Set.of("hrms.report.headcount"))).isFalse();
        assertThat(ReportKind.WORKFORCE_ANALYTICS.openableWith(Set.of("hrms.report.attrition"))).isTrue();
        assertThat(ReportKind.WORKFORCE_ANALYTICS.openableWith(Set.of("hrms.report.leave"))).isFalse();
        assertThat(ReportKind.AUDIT_LOG.schedulable()).isFalse();
        assertThat(ReportKind.EMPLOYEE_DIRECTORY.openableWith(Set.of("hrms.employee.read"))).isTrue();
    }
}
