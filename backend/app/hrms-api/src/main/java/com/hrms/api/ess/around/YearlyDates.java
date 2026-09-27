package com.hrms.api.ess.around;

import com.hrms.employee.workforce.service.MilestoneWindow;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Birthdays and work anniversaries in the caller's company: the same people
 * and dates as the dashboard's milestones ({@code GET /v1/hrms/milestones}, open
 * to anyone signed in): active employees, the day found with
 * {@link MilestoneWindow#occurrenceIn} (across the year end, 29 February on
 * 28 February in other years, never the joining year itself).
 */
final class YearlyDates {

    private YearlyDates() {}

    record Person(UUID id, String name, String department, LocalDate original) {}

    /** Active people of the company with the given date column set. */
    static List<Person> people(JdbcTemplate jdbc, String column, UUID tenantId, UUID companyId) {
        if (!"date_of_birth".equals(column) && !"date_of_joining".equals(column)) {
            throw new IllegalArgumentException(column);
        }
        return jdbc.query("""
                SELECT e.id, e.first_name, e.last_name, e.employee_code, e.%1$s AS original, d.name AS dept
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.company_id = ? AND e.is_active AND e.%1$s IS NOT NULL
                """.formatted(column), (rs, i) -> {
                    String first = rs.getString("first_name");
                    String last = rs.getString("last_name");
                    String name = ((first == null ? "" : first.trim()) + " " + (last == null ? "" : last.trim())).trim();
                    return new Person(rs.getObject("id", UUID.class), name.isEmpty() ? rs.getString("employee_code") : name,
                            rs.getString("dept"), rs.getObject("original", LocalDate.class));
                }, tenantId, companyId);
    }

    /** Who has the date inside [from, to], each with the day it falls on. */
    static List<Occurrence> within(List<Person> people, LocalDate from, LocalDate to) {
        MilestoneWindow.Range range = new MilestoneWindow.Range(from, to);
        List<Occurrence> out = new ArrayList<>();
        for (Person p : people) {
            LocalDate on = MilestoneWindow.occurrenceIn(p.original(), range);
            if (on != null) out.add(new Occurrence(p, on, on.getYear() - p.original().getYear()));
        }
        return out;
    }

    record Occurrence(Person person, LocalDate on, int years) {}

    /** "Kavya Menon’s" (the typographic apostrophe the app uses). */
    static String possessive(String name) {
        return name + "’s";
    }
}
