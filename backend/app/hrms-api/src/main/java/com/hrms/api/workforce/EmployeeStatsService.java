package com.hrms.api.workforce;

import com.hrms.core.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Loads what {@link EmployeeStats} counts: one light row per person on the
 * roster (the directory's rows: {@code is_active}), for one company or every
 * company, plus when each suspended person's suspension began. Read-only; runs
 * under the request's tenant (RLS) and filters by tenant as well.
 */
@Service
public class EmployeeStatsService {

    static final java.time.ZoneId IST = java.time.ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    public EmployeeStatsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public EmployeeStats.Response stats(UUID companyId, boolean attrition) {
        UUID tenant = TenantContext.getTenantId();
        List<EmployeeStats.Person> people = jdbc.query("""
                SELECT id, employment_status, date_of_joining, last_working_day, date_of_termination,
                       notice_start_date, probation_end_date
                  FROM hrms.employees
                 WHERE tenant_id = ? AND is_active = TRUE
                   AND (CAST(? AS uuid) IS NULL OR company_id = CAST(? AS uuid))
                """, (rs, i) -> new EmployeeStats.Person(
                        rs.getObject("id", UUID.class), rs.getString("employment_status"),
                        day(rs.getDate("date_of_joining")), day(rs.getDate("last_working_day")),
                        day(rs.getDate("date_of_termination")), day(rs.getDate("notice_start_date")),
                        day(rs.getDate("probation_end_date"))),
                tenant, str(companyId), str(companyId));
        List<UUID> suspended = people.stream().filter(p -> "SUSPENDED".equals(p.status())).map(EmployeeStats.Person::id).toList();
        return EmployeeStats.compute(people, LocalDate.now(IST), attrition, suspendedSince(tenant, suspended));
    }

    /**
     * When each person's current suspension began: the latest status-history
     * entry that moved them into SUSPENDED. Empty when nobody is suspended or
     * the history table (V143_27) is not there; the since date is then null.
     */
    Map<UUID, LocalDate> suspendedSince(UUID tenant, List<UUID> ids) {
        if (ids.isEmpty()) return Collections.emptyMap();
        String table = jdbc.queryForObject("SELECT to_regclass('hrms.employee_status_history')::text", String.class);
        if (table == null) return Collections.emptyMap();
        String marks = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> args = new ArrayList<>();
        args.add(tenant);
        args.addAll(ids);
        Map<UUID, LocalDate> out = new HashMap<>();
        jdbc.query("""
                SELECT employee_id, max(effective_on) AS since
                  FROM hrms.employee_status_history
                 WHERE tenant_id = ? AND status = 'SUSPENDED' AND from_status IS DISTINCT FROM 'SUSPENDED'
                   AND employee_id IN (""" + marks + """
                )
                 GROUP BY employee_id
                """, rs -> { out.put(rs.getObject("employee_id", UUID.class), day(rs.getDate("since"))); }, args.toArray());
        return out;
    }

    private static String str(UUID id) { return id == null ? null : id.toString(); }
    private static LocalDate day(Date d) { return d == null ? null : d.toLocalDate(); }
}
