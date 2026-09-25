package com.hrms.employee.workforce.service;

import java.util.Locale;

/**
 * The directory's milestone filters: people with a birthday, a work
 * anniversary or a retirement coming up. They pick exactly the people the
 * dashboard's "Upcoming milestones" card lists (MilestonesController), so its
 * "View all" opens the same set: the same next-occurrence rule (a 29 February
 * birthday falls on 28 February in other years), anniversaries of at least one
 * year, and retirement at 60.
 *
 * <p>Windows default to the dashboard's: birthdays in the next 14 days,
 * anniversaries in the next 31 days, retirements in the next 6 months.
 */
public final class MilestoneWindow {

    private MilestoneWindow() {}

    /** Kept equal to MilestonesController.RETIREMENT_AGE_YEARS. */
    public static final int RETIREMENT_AGE_YEARS = 60;

    public enum Kind {
        BIRTHDAY(14, 366), ANNIVERSARY(31, 366), RETIREMENT(6, 60);

        /** The dashboard's window: days, or months for retirements. */
        public final int defaultWithin;
        public final int maxWithin;

        Kind(int defaultWithin, int maxWithin) {
            this.defaultWithin = defaultWithin;
            this.maxWithin = maxWithin;
        }

        /** "birthday", "Birthdays", "anniversary", "retirement" (case and plural ignored); null when not a milestone. */
        public static Kind parse(String s) {
            if (s == null || s.isBlank()) return null;
            String v = s.trim().toLowerCase(Locale.ROOT);
            if (v.startsWith("birthday")) return BIRTHDAY;
            if (v.startsWith("anniversar")) return ANNIVERSARY;
            if (v.startsWith("retire")) return RETIREMENT;
            return null;
        }

        public int clamp(Integer within) {
            if (within == null) return defaultWithin;
            return Math.max(1, Math.min(maxWithin, within));
        }
    }

    /**
     * SQL returning the ids of the matching people (alias e = hrms.employees).
     * One parameter: the window (days, or months for retirements).
     */
    public static String idsSql(Kind kind) {
        return switch (kind) {
            case BIRTHDAY -> "SELECT e.id FROM hrms.employees e WHERE e.is_active AND e.date_of_birth IS NOT NULL AND "
                    + nextOccurrence("e.date_of_birth") + " BETWEEN current_date AND current_date + make_interval(days => ?)";
            case ANNIVERSARY -> "SELECT e.id FROM hrms.employees e WHERE e.is_active AND e.date_of_joining IS NOT NULL AND "
                    + nextOccurrence("e.date_of_joining") + " BETWEEN current_date AND current_date + make_interval(days => ?)"
                    + " AND EXTRACT(YEAR FROM " + nextOccurrence("e.date_of_joining") + ") - EXTRACT(YEAR FROM e.date_of_joining) >= 1";
            case RETIREMENT -> "SELECT e.id FROM hrms.employees e WHERE e.is_active AND e.date_of_birth IS NOT NULL AND "
                    + "(e.date_of_birth + make_interval(years => " + RETIREMENT_AGE_YEARS + "))::date"
                    + " BETWEEN current_date AND current_date + make_interval(months => ?)";
        };
    }

    /** The next time a yearly date comes round, on or after today (same rule as MilestonesController). */
    static String nextOccurrence(String col) {
        String yearsToAdd = "EXTRACT(YEAR FROM current_date)::int - EXTRACT(YEAR FROM " + col + ")::int";
        String thisYear = "(" + col + " + make_interval(years => " + yearsToAdd + "))::date";
        String nextYear = "(" + col + " + make_interval(years => " + yearsToAdd + " + 1))::date";
        return "(CASE WHEN " + thisYear + " < current_date THEN " + nextYear + " ELSE " + thisYear + " END)";
    }
}
