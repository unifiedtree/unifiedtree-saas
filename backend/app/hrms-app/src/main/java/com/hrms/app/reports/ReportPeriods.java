package com.hrms.app.reports;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Dates for scheduled report emails, kept pure so they can be unit tested.
 *
 * <ul>
 *   <li>A weekly email goes out on its weekday and covers the seven days
 *       before it (Monday's email: the previous Monday to Sunday).</li>
 *   <li>A monthly email goes out on its day of the month (1 to 28, so every
 *       month has it) and covers the previous calendar month.</li>
 *   <li>Headcount is "as of" the last day covered; the leave balance is for
 *       that day's year; attrition and Workforce Analytics show the twelve
 *       months ending with it, like the report pages do.</li>
 * </ul>
 */
final class ReportPeriods {

    private ReportPeriods() {}

    enum Frequency { WEEKLY, MONTHLY }

    /** The period an email sent on {@code sendDay} covers. */
    record Period(LocalDate from, LocalDate to) {
        String label() {
            return ReportPdfService.day(from) + " – " + ReportPdfService.day(to);
        }
    }

    /** The first send date strictly after {@code after}. */
    static LocalDate nextRun(Frequency f, Integer dayOfWeek, Integer dayOfMonth, LocalDate after) {
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
        if (f == Frequency.WEEKLY) return new Period(sendDay.minusDays(7), sendDay.minusDays(1));
        LocalDate prev = sendDay.minusMonths(1);
        return new Period(prev.withDayOfMonth(1), prev.withDayOfMonth(prev.lengthOfMonth()));
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
