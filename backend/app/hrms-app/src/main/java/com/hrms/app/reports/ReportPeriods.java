package com.hrms.app.reports;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Dates for scheduled report emails, kept pure so they can be unit tested.
 *
 * <ul>
 *   <li>A daily email (V143.62) goes out every day and covers the day before.</li>
 *   <li>A weekday email (V143.62) goes out Monday to Friday and covers the days
 *       since the previous weekday: Tuesday's covers Monday, Monday's covers
 *       Friday to Sunday.</li>
 *   <li>A weekly email goes out on its weekday and covers the seven days
 *       before it (Monday's email: the previous Monday to Sunday).</li>
 *   <li>A monthly email goes out on its day of the month (1 to 28, so every
 *       month has it) and covers the previous calendar month.</li>
 *   <li>Headcount is "as of" the last day covered; the leave balance is for
 *       that day's year; attrition and Workforce Analytics show the twelve
 *       months ending with it, like the report pages do.</li>
 *   <li>An email goes out on the job's run at its send hour (V143.62; India
 *       time), or on the first run of the day (07:05) when it has none.</li>
 * </ul>
 */
final class ReportPeriods {

    private ReportPeriods() {}

    enum Frequency {
        WEEKLY, MONTHLY, DAILY, WEEKDAYS;

        /** DAILY and WEEKDAYS need V143.62 (the widened CHECKs). */
        boolean needsScheduleOptions() {
            return this == DAILY || this == WEEKDAYS;
        }

        /** "daily", "weekday", "weekly" or "monthly", for the email text. */
        String word() {
            return switch (this) {
                case DAILY -> "daily";
                case WEEKDAYS -> "weekday";
                case WEEKLY -> "weekly";
                case MONTHLY -> "monthly";
            };
        }
    }

    /** The job's first run of the day (07:05 IST) and its last (23:05 IST); a send hour is one of these hours. */
    static final int FIRST_HOUR = 7, LAST_HOUR = 23;

    /** The period an email sent on {@code sendDay} covers. */
    record Period(LocalDate from, LocalDate to) {
        String label() {
            return from.equals(to) ? ReportPdfService.day(from) : ReportPdfService.day(from) + " – " + ReportPdfService.day(to);
        }
    }

    /**
     * Whether a schedule due on {@code dueOn} goes out on the job's run of
     * {@code today} at {@code hour}. One missed on an earlier day goes out
     * now, whatever its hour; one due today waits for its send hour (no hour =
     * the first run of the day, as before V143.62).
     */
    static boolean sendsNow(LocalDate dueOn, Integer sendHour, LocalDate today, int hour) {
        if (dueOn.isAfter(today)) return false;
        if (dueOn.isBefore(today)) return true;
        return sendHour == null || hour >= sendHour;
    }

    /** The first send date strictly after {@code after}. */
    static LocalDate nextRun(Frequency f, Integer dayOfWeek, Integer dayOfMonth, LocalDate after) {
        if (f == Frequency.DAILY) return after.plusDays(1);
        if (f == Frequency.WEEKDAYS) {
            LocalDate d = after.plusDays(1);
            while (weekend(d)) d = d.plusDays(1);
            return d;
        }
        if (f == Frequency.WEEKLY) {
            int dow = dayOfWeek == null ? 1 : dayOfWeek;
            LocalDate d = after.plusDays(1);
            while (d.getDayOfWeek() != DayOfWeek.of(dow)) d = d.plusDays(1);
            return d;
        }
        int dom = dayOfMonth == null ? 1 : Math.max(1, Math.min(28, dayOfMonth));
        LocalDate thisMonth = after.withDayOfMonth(dom);
        return thisMonth.isAfter(after) ? thisMonth : after.plusMonths(1).withDayOfMonth(dom);
    }

    static Period periodFor(Frequency f, LocalDate sendDay) {
        LocalDate yesterday = sendDay.minusDays(1);
        if (f == Frequency.DAILY) return new Period(yesterday, yesterday);
        if (f == Frequency.WEEKDAYS) return new Period(weekdayStart(sendDay), yesterday);
        if (f == Frequency.WEEKLY) return new Period(sendDay.minusDays(7), yesterday);
        LocalDate prev = sendDay.minusMonths(1);
        return new Period(prev.withDayOfMonth(1), prev.withDayOfMonth(prev.lengthOfMonth()));
    }

    /**
     * The first day a weekday email sent on {@code sendDay} covers: the
     * weekday before it. Tuesday to Friday that is yesterday; Monday's email
     * starts on Friday, so it covers Friday to Sunday.
     */
    private static LocalDate weekdayStart(LocalDate sendDay) {
        LocalDate d = sendDay.minusDays(1);
        while (weekend(d)) d = d.minusDays(1);
        return d;
    }

    private static boolean weekend(LocalDate d) {
        return d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY;
    }

    /** The report filters for one scheduled email. */
    static ReportPdfService.Params params(ReportKind kind, UUID companyId, Period p) {
        return switch (kind) {
            case HEADCOUNT -> new ReportPdfService.Params(companyId, null, null, p.to(), null);
            case LEAVE_BALANCE -> new ReportPdfService.Params(companyId, null, null, null, p.to().getYear());
            case DIVERSITY -> new ReportPdfService.Params(companyId, null, null, null, null);
            case ATTRITION -> new ReportPdfService.Params(companyId, p.to().withDayOfMonth(1).minusMonths(11), p.to(), null, null);
            case WORKFORCE_ANALYTICS -> new ReportPdfService.Params(companyId, p.to().withDayOfMonth(1).minusMonths(11), p.to(), p.to(), null);
            default -> new ReportPdfService.Params(companyId, p.from(), p.to(), null, null);
        };
    }
}
