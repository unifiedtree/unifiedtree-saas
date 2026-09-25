package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

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
 *
 * <p>The card can also show a chosen date range per list ({@link Range}, at
 * most 12 months). Range lists use {@link #occurrenceIn} for birthdays and
 * anniversaries and the company's retirement age for retirements, the same
 * rules as the card's range lists, so "View all" opens the same people.
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

    /** The longest range one request may ask for: it must end before {@code from} plus this many months. */
    public static final int MAX_RANGE_MONTHS = 12;

    /**
     * A chosen date range, both ends included. At most {@link #MAX_RANGE_MONTHS}
     * months long, so a yearly date falls inside it at most once.
     */
    public record Range(LocalDate from, LocalDate to) {
        public Range {
            if (from == null || to == null) {
                throw new BusinessRuleException("Choose both a start date and an end date", "MILESTONE_RANGE_INVALID");
            }
            if (to.isBefore(from)) {
                throw new BusinessRuleException("The end date is before the start date", "MILESTONE_RANGE_INVALID");
            }
            if (!to.isBefore(from.plusMonths(MAX_RANGE_MONTHS))) {
                throw new BusinessRuleException("A date range can be at most 12 months", "MILESTONE_RANGE_INVALID");
            }
        }

        /** The range from two optional request parameters; null when neither is given. */
        public static Range optional(LocalDate from, LocalDate to) {
            return from == null && to == null ? null : new Range(from, to);
        }
    }

    /**
     * The day a yearly date (a birthday, a joining day) falls on inside the
     * range, or null when it doesn't fall inside it.
     *
     * <p>A 29 February date falls on 28 February in other years
     * ({@link LocalDate#withYear} moves it to the last valid day), the same as
     * the dashboard's SQL. Only years after the original one count: the
     * joining year itself is not an anniversary, and a birthday needs the
     * person to have been born. A range across the year end (December to
     * January) looks at both years.
     */
    public static LocalDate occurrenceIn(LocalDate original, Range range) {
        if (original == null || range == null) return null;
        for (int year = range.from().getYear(); year <= range.to().getYear(); year++) {
            if (year <= original.getYear()) continue;
            LocalDate on = original.withYear(year);
            if (!on.isBefore(range.from()) && !on.isAfter(range.to())) return on;
        }
        return null;
    }

    /**
     * Retirements inside a range: the day a person reaches their company's
     * retirement age (HR Configuration, 60 when unset or unusable), the same
     * rule as RetirementService and the dashboard card. Two parameters: from, to.
     */
    static final String RETIREMENT_IN_RANGE_SQL = """
            SELECT e.id FROM hrms.employees e
              JOIN org.companies c ON c.id = e.company_id
              LEFT JOIN settings.hr_configuration h ON h.company_id = e.company_id AND h.tenant_id = e.tenant_id
             WHERE e.is_active AND e.date_of_birth IS NOT NULL
               AND e.employment_status NOT IN ('EXITED', 'TERMINATED', 'RESIGNED')
               AND (e.date_of_birth + make_interval(years => (CASE WHEN h.retirement_age BETWEEN 30 AND 100
                        THEN h.retirement_age ELSE 60 END)))::date BETWEEN ? AND ?
            """;

    /**
     * Ids of the people whose milestone falls inside a chosen range (alias e =
     * hrms.employees; the caller's tenant through RLS, as {@link #idsSql}).
     */
    public static List<UUID> idsIn(JdbcTemplate jdbc, Kind kind, Range range) {
        return switch (kind) {
            case BIRTHDAY -> yearlyIn(jdbc, "e.date_of_birth", range);
            case ANNIVERSARY -> yearlyIn(jdbc, "e.date_of_joining", range);
            case RETIREMENT -> jdbc.queryForList(RETIREMENT_IN_RANGE_SQL, UUID.class, range.from(), range.to());
        };
    }

    private static List<UUID> yearlyIn(JdbcTemplate jdbc, String col, Range range) {
        List<UUID> ids = new ArrayList<>();
        jdbc.query("SELECT e.id, " + col + " AS d FROM hrms.employees e WHERE e.is_active AND " + col + " IS NOT NULL", rs -> {
            java.sql.Date d = rs.getDate("d");
            if (d != null && occurrenceIn(d.toLocalDate(), range) != null) ids.add(rs.getObject("id", UUID.class));
        });
        return ids;
    }

    /** The next time a yearly date comes round, on or after today (same rule as MilestonesController). */
    static String nextOccurrence(String col) {
        String yearsToAdd = "EXTRACT(YEAR FROM current_date)::int - EXTRACT(YEAR FROM " + col + ")::int";
        String thisYear = "(" + col + " + make_interval(years => " + yearsToAdd + "))::date";
        String nextYear = "(" + col + " + make_interval(years => " + yearsToAdd + " + 1))::date";
        return "(CASE WHEN " + thisYear + " < current_date THEN " + nextYear + " ELSE " + thisYear + " END)";
    }
}
