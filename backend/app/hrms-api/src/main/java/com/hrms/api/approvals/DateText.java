package com.hrms.api.approvals;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.Locale;

/** Dates and times the way approval lines and notifications write them (India time, English month names). */
public final class DateText {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH);

    private DateText() {
    }

    /** Today in India. */
    public static LocalDate todayIst() {
        return LocalDate.now(IST);
    }

    /** "28 Sep", "28–29 Sep", "30 Sep – 2 Oct", "30 Dec 2026 – 2 Jan 2027". */
    public static String shortRange(LocalDate from, LocalDate to) {
        if (from == null) return "";
        if (to == null || to.equals(from)) return DAY_MONTH.format(from);
        if (from.getYear() != to.getYear()) return LONG.format(from) + " – " + LONG.format(to);
        if (from.getMonth() == to.getMonth()) return from.getDayOfMonth() + "–" + DAY_MONTH.format(to);
        return DAY_MONTH.format(from) + " – " + DAY_MONTH.format(to);
    }

    /** "for 5 Jul 2026" or "for 5 Jul 2026 to 7 Jul 2026". */
    public static String longRange(LocalDate from, LocalDate to) {
        if (from == null) return "";
        if (to == null || to.equals(from)) return "for " + LONG.format(from);
        return "for " + LONG.format(from) + " to " + LONG.format(to);
    }

    /** "5 Jul 2026". */
    public static String longDay(LocalDate day) {
        return day == null ? "" : LONG.format(day);
    }

    /** "Sep 2026". */
    public static String month(int year, int month) {
        return java.time.Month.of(month).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + year;
    }

    /** "09:30" in India time. */
    public static String time(java.time.Instant at) {
        return at == null ? "" : HH_MM.format(at.atZone(IST));
    }

    /** "07:00" from a shift's clock time. */
    public static String time(LocalTime t) {
        return t == null ? "" : HH_MM.format(t);
    }
}
