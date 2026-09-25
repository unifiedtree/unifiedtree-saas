package com.hrms.leave.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.Month;
import java.time.format.TextStyle;
import java.util.Locale;

/**
 * The arithmetic behind leave accrual and the year-end carry forward. Pure
 * functions, so the rules can be tested without a database.
 *
 * <p><b>Accrual.</b> A leave type is credited one of three ways:
 * <ul>
 *   <li>{@code YEARLY} ("credited upfront"): the whole annual quota on the
 *       first day of the leave year (or on joining). This is what every balance
 *       did before V143.23, and stays the default.</li>
 *   <li>{@code MONTHLY}: quota / 12 on the 1st of every month.</li>
 *   <li>{@code QUARTERLY}: quota / 4 on the 1st of January, April, July and
 *       October.</li>
 * </ul>
 * Someone who joins mid-year is credited from the period they joined in: a
 * period counts when they had joined by its last day. Credits are "to date":
 * the balance should hold {@link #entitlementToDate} by today, and the job
 * only ever tops a balance up to that figure, never down, which is what makes
 * it safe to run any number of times.
 *
 * <p><b>Carry forward.</b> At the end of a leave year the unused balance
 * (entitlement + carried in − used − pending) moves into the next year up to
 * the type's cap; the rest lapses. A type without carry forward lapses all of
 * it.
 */
public final class LeaveAccrualMath {

    public static final String YEARLY = "YEARLY";
    public static final String MONTHLY = "MONTHLY";
    public static final String QUARTERLY = "QUARTERLY";

    private LeaveAccrualMath() {}

    /** The stored value for a frequency; unknown / blank / "UPFRONT" mean YEARLY. */
    public static String normalizeFrequency(String raw) {
        if (raw == null) return YEARLY;
        String f = raw.trim().toUpperCase(Locale.ROOT);
        return switch (f) {
            case MONTHLY -> MONTHLY;
            case QUARTERLY -> QUARTERLY;
            default -> YEARLY;
        };
    }

    /** True when {@code raw} is one of the values a client may send. */
    public static boolean isKnownFrequency(String raw) {
        if (raw == null) return true;
        String f = raw.trim().toUpperCase(Locale.ROOT);
        return f.equals(YEARLY) || f.equals(MONTHLY) || f.equals(QUARTERLY) || f.equals("UPFRONT");
    }

    /** MONTHLY and QUARTERLY types are credited over the year; YEARLY is credited in one go. */
    public static boolean isAccruing(String frequency) {
        String f = normalizeFrequency(frequency);
        return f.equals(MONTHLY) || f.equals(QUARTERLY);
    }

    public static int periodsPerYear(String frequency) {
        return switch (normalizeFrequency(frequency)) {
            case MONTHLY -> 12;
            case QUARTERLY -> 4;
            default -> 1;
        };
    }

    /** 1-based period of the year {@code date} falls in (month 1–12, quarter 1–4, or 1). */
    public static int periodOf(String frequency, LocalDate date) {
        return switch (normalizeFrequency(frequency)) {
            case MONTHLY -> date.getMonthValue();
            case QUARTERLY -> (date.getMonthValue() - 1) / 3 + 1;
            default -> 1;
        };
    }

    /** The ledger key of a period: "2026-09", "2026-Q3" or "2026". */
    public static String periodKey(String frequency, int year, int period) {
        return switch (normalizeFrequency(frequency)) {
            case MONTHLY -> "%d-%02d".formatted(year, period);
            case QUARTERLY -> "%d-Q%d".formatted(year, period);
            default -> String.valueOf(year);
        };
    }

    /** A person-readable period: "Sep 2026", "Jul–Sep 2026" or "2026". */
    public static String periodLabel(String frequency, int year, int period) {
        return switch (normalizeFrequency(frequency)) {
            case MONTHLY -> Month.of(period).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + year;
            case QUARTERLY -> Month.of((period - 1) * 3 + 1).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + "–"
                    + Month.of(period * 3).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " " + year;
            default -> String.valueOf(year);
        };
    }

    /**
     * How many of {@code year}'s periods have been credited by {@code today}
     * for someone who joined on {@code joined} (null = joined before the year).
     */
    public static int creditedPeriods(String frequency, LocalDate joined, int year, LocalDate today) {
        int n = periodsPerYear(frequency);
        int last = year < today.getYear() ? n : year > today.getYear() ? 0 : periodOf(frequency, today);
        int first = 1;
        if (joined != null) {
            if (joined.getYear() > year) return 0;
            if (joined.getYear() == year) first = periodOf(frequency, joined);
        }
        return Math.max(0, last - first + 1);
    }

    /**
     * What a balance for {@code year} should hold by {@code today}. YEARLY is the
     * whole quota (unchanged behaviour: not pro-rated). MONTHLY / QUARTERLY are
     * the quota pro-rated over the periods credited so far, to two decimals.
     */
    public static double entitlementToDate(String frequency, double annualQuota, LocalDate joined, int year, LocalDate today) {
        if (!isAccruing(frequency)) return round2(annualQuota);
        int periods = creditedPeriods(frequency, joined, year, today);
        return round2(annualQuota * periods / periodsPerYear(frequency));
    }

    /** What one period credits: quota / 12, quota / 4, or the whole quota. */
    public static double perPeriod(String frequency, double annualQuota) {
        return round2(annualQuota / periodsPerYear(frequency));
    }

    /** [carried, lapsed] for an unused balance at year end. */
    public static double[] carryForward(double unused, boolean carryAllowed, Integer cap) {
        double u = round2(unused);
        if (u <= 0) return new double[]{0, 0};
        if (!carryAllowed || cap == null || cap <= 0) return new double[]{0, u};
        double carried = Math.min(u, cap);
        return new double[]{round2(carried), round2(u - carried)};
    }

    public static double round2(double v) {
        return BigDecimal.valueOf(v).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }
}
