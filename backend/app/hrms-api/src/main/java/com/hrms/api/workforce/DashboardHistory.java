package com.hrms.api.workforce;

import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Loads what the admin dashboard's history view needs (the rules live in
 * {@link DashboardAsOf}). Read-only; runs under the request's tenant (RLS) and
 * filters by tenant as well.
 */
@Component
public class DashboardHistory {

    private final JdbcTemplate jdbc;
    private final EmployeeRepository employees;

    public DashboardHistory(JdbcTemplate jdbc, EmployeeRepository employees) {
        this.jdbc = jdbc;
        this.employees = employees;
    }

    /** One company's headcount on {@code date}, with the joiners and leavers of that month up to it. */
    public DashboardAsOf.Headcount headcount(UUID tenant, UUID companyId, LocalDate date) {
        return headcount(tenant, companyId, date, false);
    }

    /** {@link #headcount(UUID, UUID, LocalDate)}; {@code throughLastDay}: see {@link DashboardAsOf#headcount(List, Map, LocalDate, boolean)}. */
    public DashboardAsOf.Headcount headcount(UUID tenant, UUID companyId, LocalDate date, boolean throughLastDay) {
        List<DashboardAsOf.Person> people = people(tenant, companyId, throughLastDay);
        Map<UUID, List<DashboardAsOf.Change>> history = jdbc.query("""
                SELECT h.employee_id, h.status, h.effective_on, h.recorded_at
                  FROM hrms.employee_status_history h
                  JOIN hrms.employees e ON e.id = h.employee_id AND e.tenant_id = h.tenant_id
                 WHERE h.tenant_id = ? AND e.company_id = ?
                """, (rs, i) -> new DashboardAsOf.Change(rs.getObject("employee_id", UUID.class), rs.getString("status"),
                rs.getDate("effective_on").toLocalDate(), instant(rs.getTimestamp("recorded_at"))),
                tenant, companyId).stream().collect(Collectors.groupingBy(DashboardAsOf.Change::employeeId));
        return DashboardAsOf.headcount(people, history, date, throughLastDay);
    }

    /**
     * The joiners and leavers of one company from {@code from} to {@code to}
     * (the dashboard's date range), by {@link DashboardAsOf#moves}; joining
     * dates as {@link #headcount(UUID, UUID, LocalDate, boolean)} reads them.
     */
    public DashboardAsOf.Moves moves(UUID tenant, UUID companyId, LocalDate from, LocalDate to, boolean throughLastDay) {
        return DashboardAsOf.moves(people(tenant, companyId, throughLastDay), from, to);
    }

    private List<DashboardAsOf.Person> people(UUID tenant, UUID companyId, boolean throughLastDay) {
        // A past day: someone without a joining date counts from the day their record was created, as that
        // day's attendance roster counts them (leftOnOrAfter, ReportService.ON_ROLL_DURING).
        return jdbc.query("""
                SELECT id, date_of_joining, (created_at AT TIME ZONE 'Asia/Kolkata')::date AS created_on,
                       employment_status, last_working_day, date_of_termination
                  FROM hrms.employees WHERE tenant_id = ? AND company_id = ?
                """, (rs, i) -> new DashboardAsOf.Person(rs.getObject("id", UUID.class),
                joinedOrCreated(day(rs.getDate("date_of_joining")), day(rs.getDate("created_on")), throughLastDay),
                rs.getString("employment_status"), day(rs.getDate("last_working_day")), day(rs.getDate("date_of_termination"))),
                tenant, companyId);
    }

    /**
     * People of the company who have since left (exited, terminated, resigned or
     * retired) but were still employed at some point from {@code from} to
     * {@code to}: their last working day (else termination date) is on or after
     * {@code from}, and they had joined by {@code to} (without a joining date,
     * their record existed by then). Maps each to that last day.
     */
    public Map<UUID, LocalDate> leftOnOrAfter(UUID tenant, UUID companyId, LocalDate from, LocalDate to) {
        Map<UUID, LocalDate> out = new HashMap<>();
        jdbc.query("""
                SELECT id, COALESCE(last_working_day, date_of_termination) AS last_day
                  FROM hrms.employees
                 WHERE tenant_id = ? AND company_id = ?
                   AND employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')
                   AND COALESCE(last_working_day, date_of_termination) >= ?
                   AND COALESCE(date_of_joining, (created_at AT TIME ZONE 'Asia/Kolkata')::date) <= ?
                """, rs -> { out.put(rs.getObject("id", UUID.class), rs.getDate("last_day").toLocalDate()); },
                tenant, companyId, Date.valueOf(from), Date.valueOf(to));
        return out;
    }

    /** The people of {@link #leftOnOrAfter} for one day, loaded, to add to a team as it was on {@code date}. */
    public List<Employee> formerStaff(UUID tenant, UUID companyId, LocalDate date) {
        return formerStaff(tenant, companyId, date, date);
    }

    /** The people of {@link #leftOnOrAfter}, loaded, to add to a team over a range of days. */
    public List<Employee> formerStaff(UUID tenant, UUID companyId, LocalDate from, LocalDate to) {
        Map<UUID, LocalDate> left = leftOnOrAfter(tenant, companyId, from, to);
        return left.isEmpty() ? List.of() : employees.findAllById(left.keySet());
    }

    /** Last working day (else termination date) of the given people who have left; others are absent from the map. */
    public Map<UUID, LocalDate> lastDays(UUID tenant, List<UUID> employeeIds) {
        Map<UUID, LocalDate> out = new HashMap<>();
        if (employeeIds.isEmpty()) return out;
        String in = String.join(",", java.util.Collections.nCopies(employeeIds.size(), "?"));
        Object[] args = new Object[employeeIds.size() + 1];
        args[0] = tenant;
        for (int i = 0; i < employeeIds.size(); i++) args[i + 1] = employeeIds.get(i);
        jdbc.query("""
                SELECT id, COALESCE(last_working_day, date_of_termination) AS last_day
                  FROM hrms.employees
                 WHERE tenant_id = ? AND employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')
                   AND COALESCE(last_working_day, date_of_termination) IS NOT NULL
                   AND id IN (""" + in + ")", rs -> { out.put(rs.getObject("id", UUID.class), rs.getDate("last_day").toLocalDate()); }, args);
        return out;
    }

    /** The joining date; on a past day ({@code throughLastDay}) without one, the day the record was created. */
    static LocalDate joinedOrCreated(LocalDate joined, LocalDate created, boolean throughLastDay) {
        return joined != null || !throughLastDay ? joined : created;
    }

    private static LocalDate day(Date d) { return d == null ? null : d.toLocalDate(); }
    private static java.time.Instant instant(Timestamp t) { return t == null ? null : t.toInstant(); }
}
