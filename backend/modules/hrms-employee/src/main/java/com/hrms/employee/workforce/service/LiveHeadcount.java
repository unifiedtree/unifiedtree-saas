package com.hrms.employee.workforce.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * How many people currently work in a company, branch, department or
 * designation, counted from hrms.employees when asked.
 *
 * <p>The *_count_cached / headcount_cached columns these responses used to
 * return were never updated after signup (frozen at 1 for the seeded rows and
 * 0 for everything created later), and keeping them in step would mean
 * touching every path that creates, moves or exits an employee. "Currently
 * works here" is ACTIVE, PROBATION or NOTICE_PERIOD, the same people the
 * headcount report counts. Queries run under the request's tenant (RLS).
 */
@Component
public class LiveHeadcount {

    private static final Set<String> COLUMNS = Set.of("company_id", "branch_id", "department_id", "designation_id");
    private static final String EMPLOYED = "is_active = TRUE AND employment_status IN ('ACTIVE','PROBATION','NOTICE_PERIOD')";

    private final JdbcTemplate jdbc;

    public LiveHeadcount(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** People employed per value of {@code column} (company_id, branch_id, department_id or designation_id). */
    public Map<UUID, Integer> byColumn(String column) {
        String col = checked(column);
        Map<UUID, Integer> out = new HashMap<>();
        jdbc.query("SELECT " + col + ", count(*) FROM hrms.employees WHERE " + EMPLOYED + " AND " + col + " IS NOT NULL GROUP BY " + col,
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject(1, UUID.class), rs.getInt(2)));
        return out;
    }

    /** People employed where {@code column} = {@code id}. */
    public int countFor(String column, UUID id) {
        if (id == null) return 0;
        Integer n = jdbc.queryForObject("SELECT count(*) FROM hrms.employees WHERE " + EMPLOYED + " AND " + checked(column) + " = ?", Integer.class, id);
        return n == null ? 0 : n;
    }

    private static String checked(String column) {
        if (!COLUMNS.contains(column)) throw new IllegalArgumentException("Unsupported headcount column: " + column);
        return column;
    }
}
