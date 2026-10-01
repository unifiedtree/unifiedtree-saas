package com.hrms.api.workforce.search;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Redesign BW-02: the ⌘K preview's facts about the people a search found: branch, who they report
 * to, when they joined and their employment status. The same visibility as {@code GET /v1/search}
 * (the Workforce Directory's {@code hrms.employee.read}, active people, the caller's tenant), and
 * only directory-level facts: nothing the directory list doesn't already show.
 *
 * <p>JDBC over existing tables; {@code WorkforceEmployeeService} and its DTOs are not touched.
 */
@Repository
public class PersonFactsQueries {

    public static final int MAX_IDS = 20;

    /** One person's facts; any of them may be null. */
    public record PersonFacts(UUID id, String branchName, String managerName, LocalDate dateOfJoining, String employmentStatus) {}

    private final JdbcTemplate jdbc;

    public PersonFactsQueries(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Facts for at most {@value #MAX_IDS} of the given ids (duplicates and nulls ignored), in the tenant only. */
    @Transactional(readOnly = true)
    public List<PersonFacts> facts(UUID tenant, Collection<UUID> ids) {
        List<UUID> wanted = ids == null ? List.of() : ids.stream().filter(java.util.Objects::nonNull).distinct().limit(MAX_IDS).toList();
        if (tenant == null || wanted.isEmpty()) return List.of();
        List<Object> args = new ArrayList<>();
        args.add(tenant);
        args.addAll(wanted);
        return jdbc.query(sql(wanted.size()), (rs, i) -> {
            Date joined = rs.getDate("date_of_joining");
            String manager = rs.getString("manager_name");
            return new PersonFacts(rs.getObject("id", UUID.class), rs.getString("branch_name"),
                    manager == null || manager.isBlank() ? null : manager.trim(),
                    joined == null ? null : joined.toLocalDate(), rs.getString("employment_status"));
        }, args.toArray());
    }

    static String sql(int count) {
        return """
            SELECT e.id, b.name AS branch_name, concat_ws(' ', m.first_name, m.last_name) AS manager_name,
                   e.date_of_joining, e.employment_status
              FROM hrms.employees e
              LEFT JOIN org.branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
              LEFT JOIN hrms.employees m ON m.id = e.reporting_manager_id AND m.tenant_id = e.tenant_id
             WHERE e.tenant_id = ? AND e.is_active = TRUE
               AND e.id IN (""" + String.join(", ", Collections.nCopies(count, "?")) + ")";
    }
}
