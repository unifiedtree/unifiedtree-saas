package com.hrms.api.workforce;

import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Upcoming people milestones — birthdays, work anniversaries and retirements.
 *
 * <p>Shape follows the reference dashboard the client supplied
 * (unified-tree-hr-dashboard), whose "Upcoming Milestones" panel is three
 * columns: Birthdays this week, Anniversaries this month, Retirements in the
 * next six months. Windows are query parameters rather than hardcoded so the
 * mobile app can show a tighter range than a desktop dashboard.
 *
 * <p><b>Day-of-year matching, not date matching.</b> A birthday recurs, so the
 * comparison ignores the year. Doing that in SQL with a naive
 * {@code EXTRACT(month)/EXTRACT(day)} range breaks across the 31 Dec → 1 Jan
 * boundary, which is exactly when a "next 7 days" list matters for a December
 * birthday. Both anniversary queries therefore project this year's and next
 * year's occurrence and take whichever falls inside the window.
 *
 * <p><b>Leap-day birthdays</b> (29 Feb) are projected onto 28 Feb in non-leap
 * years rather than silently vanishing, which is what a plain
 * {@code make_date} would do — it errors on an invalid date.
 *
 * <p>Read-only, tenant-scoped, and visible to any authenticated member of the
 * workspace: knowing a colleague's birthday is not privileged information, and
 * the payload deliberately carries no contact details, salary or identifiers
 * beyond what a team directory already shows.
 */
@RestController
@RequestMapping("/v1/hrms/milestones")
public class MilestonesController {

    /**
     * Superannuation age used to project a retirement date, since the schema
     * has no retirement_date column. 60 is the common private-sector norm in
     * India. It belongs in settings.* eventually — a workspace with a
     * different policy currently has no way to change it, so treat any
     * retirement row as indicative rather than authoritative.
     */
    private static final int RETIREMENT_AGE_YEARS = 60;

    private final JdbcTemplate jdbc;

    public MilestonesController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Operation(summary = "Upcoming birthdays, work anniversaries and retirements")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public MilestonesResponse upcoming(
            @RequestParam(value = "birthdayDays",     defaultValue = "7")   int birthdayDays,
            @RequestParam(value = "anniversaryDays",  defaultValue = "31")  int anniversaryDays,
            @RequestParam(value = "retirementMonths", defaultValue = "6")   int retirementMonths) {

        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            return new MilestonesResponse(List.of(), List.of(), List.of());
        }
        int bDays = clamp(birthdayDays, 1, 366);
        int aDays = clamp(anniversaryDays, 1, 366);
        int rMonths = clamp(retirementMonths, 1, 60);

        return new MilestonesResponse(
                birthdays(tenantId, bDays),
                anniversaries(tenantId, aDays),
                retirements(tenantId, rMonths));
    }

    // -- birthdays -------------------------------------------------------------

    private List<Milestone> birthdays(UUID tenantId, int days) {
        return query("""
                WITH base AS (
                  SELECT e.id, e.first_name, e.last_name, e.employee_code,
                         d.name AS dept, e.date_of_birth AS src,
                         %s AS occurs
                    FROM hrms.employees e
                    LEFT JOIN hrms.departments d ON d.id = e.department_id
                   WHERE e.tenant_id = ? AND e.is_active AND e.date_of_birth IS NOT NULL
                )
                SELECT id, first_name, last_name, employee_code, dept, src, occurs,
                       NULL::int AS years
                  FROM base
                 WHERE occurs BETWEEN current_date AND current_date + make_interval(days => ?)
                 ORDER BY occurs
                """.formatted(NEXT_OCCURRENCE_SQL), tenantId, days);
    }

    // -- work anniversaries ----------------------------------------------------

    private List<Milestone> anniversaries(UUID tenantId, int days) {
        // years = which anniversary this upcoming occurrence represents. A
        // joiner from 2023 whose next occurrence is in 2026 is hitting 3 years.
        // Someone who joined this month has years = 0; excluded, because "0
        // years with the company" is not a milestone worth announcing.
        return query("""
                WITH base AS (
                  SELECT e.id, e.first_name, e.last_name, e.employee_code,
                         d.name AS dept, e.date_of_joining AS src,
                         %s AS occurs
                    FROM hrms.employees e
                    LEFT JOIN hrms.departments d ON d.id = e.department_id
                   WHERE e.tenant_id = ? AND e.is_active AND e.date_of_joining IS NOT NULL
                )
                SELECT id, first_name, last_name, employee_code, dept, src, occurs,
                       (EXTRACT(YEAR FROM occurs) - EXTRACT(YEAR FROM src))::int AS years
                  FROM base
                 WHERE occurs BETWEEN current_date AND current_date + make_interval(days => ?)
                   AND (EXTRACT(YEAR FROM occurs) - EXTRACT(YEAR FROM src)) >= 1
                 ORDER BY occurs
                """.formatted(NEXT_OCCURRENCE_SQL.replace("date_of_birth", "date_of_joining")),
                tenantId, days);
    }

    // -- retirements -----------------------------------------------------------

    private List<Milestone> retirements(UUID tenantId, int months) {
        return query("""
                SELECT e.id, e.first_name, e.last_name, e.employee_code,
                       d.name AS dept, e.date_of_birth AS src,
                       (e.date_of_birth + make_interval(years => %d))::date AS occurs,
                       %d AS years
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id
                 WHERE e.tenant_id = ? AND e.is_active AND e.date_of_birth IS NOT NULL
                   AND (e.date_of_birth + make_interval(years => %d))::date
                       BETWEEN current_date AND current_date + make_interval(months => ?)
                 ORDER BY occurs
                """.formatted(RETIREMENT_AGE_YEARS, RETIREMENT_AGE_YEARS, RETIREMENT_AGE_YEARS),
                tenantId, months);
    }

    /**
     * This year's occurrence of a recurring date, rolling to next year once it
     * has passed. 29 Feb falls back to 28 Feb in a non-leap year — make_date
     * would raise "date field value out of range" and take the whole query
     * down with it.
     */
    private static final String NEXT_OCCURRENCE_SQL = """
            CASE
              WHEN EXTRACT(MONTH FROM e.date_of_birth) = 2 AND EXTRACT(DAY FROM e.date_of_birth) = 29
                   AND NOT (
                     (EXTRACT(YEAR FROM current_date)::int %% 4 = 0
                      AND EXTRACT(YEAR FROM current_date)::int %% 100 <> 0)
                     OR EXTRACT(YEAR FROM current_date)::int %% 400 = 0)
                THEN make_date(EXTRACT(YEAR FROM current_date)::int, 2, 28)
              ELSE make_date(EXTRACT(YEAR FROM current_date)::int,
                             EXTRACT(MONTH FROM e.date_of_birth)::int,
                             EXTRACT(DAY  FROM e.date_of_birth)::int)
            END
            + CASE WHEN make_date(EXTRACT(YEAR FROM current_date)::int,
                                  EXTRACT(MONTH FROM e.date_of_birth)::int,
                                  LEAST(EXTRACT(DAY FROM e.date_of_birth)::int, 28))
                        < current_date
                   THEN make_interval(years => 1) ELSE make_interval() END
            """;

    private List<Milestone> query(String sql, UUID tenantId, int window) {
        List<Milestone> out = new ArrayList<>();
        jdbc.query(sql, rs -> {
            String first = rs.getString("first_name");
            String last  = rs.getString("last_name");
            String name  = ((first == null ? "" : first) + " " + (last == null ? "" : last)).trim();
            java.sql.Date occurs = rs.getDate("occurs");
            int years = rs.getInt("years");
            out.add(new Milestone(
                    rs.getString("id"),
                    name.isBlank() ? rs.getString("employee_code") : name,
                    initials(first, last),
                    rs.getString("dept"),
                    occurs == null ? null : occurs.toLocalDate(),
                    rs.wasNull() ? null : years));
        }, tenantId, window);
        return out;
    }

    private static String initials(String first, String last) {
        StringBuilder sb = new StringBuilder();
        if (first != null && !first.isBlank()) sb.append(Character.toUpperCase(first.charAt(0)));
        if (last  != null && !last.isBlank())  sb.append(Character.toUpperCase(last.charAt(0)));
        return sb.length() == 0 ? "?" : sb.toString();
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    /**
     * @param date  the upcoming occurrence, already rolled forward to the next
     *              time it happens (not the original birth/joining date)
     * @param years which anniversary this is; null for birthdays
     */
    public record Milestone(String employeeId, String name, String initials,
                            String department, LocalDate date, Integer years) {}

    public record MilestonesResponse(List<Milestone> birthdays,
                                     List<Milestone> anniversaries,
                                     List<Milestone> retirements) {}
}
