package com.hrms.api.attendance;

import com.hrms.api.attendance.AttendanceInsightsController.Breakdown;
import com.hrms.api.attendance.AttendanceInsightsController.Group;
import com.hrms.api.attendance.AttendanceInsightsController.Punctuality;
import com.hrms.attendance.policy.AttendancePolicyService;
import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The analytics breakdown (BW-20) and punctuality (BW-21) checked against plain
 * SQL over the same punches, and the new roster, head-count and overtime
 * queries run against the real schema (with V143.54 applied).
 *
 * <p>Opt-in, like {@link ShiftChangeRequestEffectiveDateTest}: only against a
 * migrated, disposable database (RECOVERY_TEST_JDBC_URL). Everything lives in a
 * random tenant and is deleted afterwards.
 */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class AttendanceInsightsSqlTest {

    private final DriverManagerDataSource source = new DriverManagerDataSource(
            System.getenv("RECOVERY_TEST_JDBC_URL"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
    private final JdbcTemplate jdbc = new JdbcTemplate(source);
    private final NamedParameterJdbcTemplate named = new NamedParameterJdbcTemplate(source);

    private final UUID tenant = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();
    private final UUID deptA = UUID.randomUUID();
    private final UUID deptB = UUID.randomUUID();
    private final UUID shift = UUID.randomUUID();
    private final List<Employee> team = new ArrayList<>();
    // Monday 3 to Friday 7 August 2026, a working week; the shift starts at 09:00 with 10 minutes' grace.
    private final LocalDate mon = LocalDate.of(2026, 8, 3);
    private final LocalDate fri = mon.plusDays(4);

    @BeforeEach void seed() {
        TenantContext.setTenantId(tenant);
        jdbc.update("INSERT INTO hrms.departments(id, tenant_id, company_id, name) VALUES (?, ?, ?, 'QA insights A'), (?, ?, ?, 'QA insights B')",
                deptA, tenant, company, deptB, tenant, company);
        jdbc.update("INSERT INTO attendance.shift_policies(id, tenant_id, company_id, name, shift_type, start_time, end_time, grace_period_minutes) "
                + "VALUES (?, ?, ?, 'QA General', 'FIXED', '09:00', '17:00', 10)", shift, tenant, company);
        // Each person's check-ins (IST), Monday to Friday; null = no punch.
        person("Early", deptA, "08:55", "08:55", "08:55", "08:55", "08:55");
        person("Late", deptA, "09:25", "08:58", "09:40", "09:05", null);
        person("Steady", deptB, "09:00", "09:00", "09:00", "09:00", null);
    }

    private void person(String name, UUID dept, String... checkIns) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, "
                        + "employment_status, date_of_joining, weekly_off_days, department_id) "
                        + "VALUES (?, ?, ?, ?, ?, 'Insights', 'FULL_TIME', 'ACTIVE', '2026-06-01', '6,7', ?)",
                id, tenant, company, "QAI-" + id.toString().substring(0, 8), name, dept);
        jdbc.update("INSERT INTO attendance.employee_shift_assignments(id, tenant_id, employee_id, shift_policy_id, effective_from) "
                + "VALUES (?, ?, ?, ?, '2026-06-01')", UUID.randomUUID(), tenant, id, shift);
        for (int i = 0; i < checkIns.length; i++) {
            if (checkIns[i] == null) continue;
            LocalDate d = mon.plusDays(i);
            jdbc.update("INSERT INTO attendance.records(id, tenant_id, employee_id, company_id, attendance_date, check_in_at) "
                    + "VALUES (?, ?, ?, ?, ?, (?::date + ?::time) AT TIME ZONE 'Asia/Kolkata')",
                    UUID.randomUUID(), tenant, id, company, d, d.toString(), checkIns[i]);
        }
        Employee e = new Employee();
        e.setId(id);
        e.setFirstName(name);
        e.setLastName("Insights");
        e.setCompanyId(company);
        e.setDepartmentId(dept);
        team.add(e);
    }

    @AfterEach void cleanup() {
        jdbc.update("DELETE FROM attendance.records WHERE tenant_id = ?", tenant);
        jdbc.update("DELETE FROM attendance.employee_shift_assignments WHERE tenant_id = ?", tenant);
        jdbc.update("DELETE FROM attendance.shift_policies WHERE tenant_id = ?", tenant);
        jdbc.update("DELETE FROM hrms.employees WHERE tenant_id = ?", tenant);
        jdbc.update("DELETE FROM hrms.departments WHERE tenant_id = ?", tenant);
        TenantContext.clear();
    }

    private AttendanceInsightsController controller() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        when(scope.resolve(any(), isNull())).thenReturn(team);
        return new AttendanceInsightsController(scope,
                new EffectiveDayStatusService(jdbc, new AttendancePolicyService(jdbc)), jdbc);
    }

    /** The same numbers straight from the punches: attended, late (past 09:10), average minutes after 09:00. */
    private Map<UUID, Map<String, Object>> bySql() {
        Map<UUID, Map<String, Object>> out = new HashMap<>();
        jdbc.query("""
                SELECT e.department_id, count(DISTINCT e.id) AS people,
                       count(r.id) AS attended,
                       count(r.id) FILTER (WHERE (r.check_in_at AT TIME ZONE 'Asia/Kolkata')::time > time '09:10') AS late,
                       avg(extract(epoch FROM ((r.check_in_at AT TIME ZONE 'Asia/Kolkata')::time - time '09:00')) / 60) AS arrival
                  FROM hrms.employees e
                  LEFT JOIN attendance.records r ON r.employee_id = e.id AND r.attendance_date BETWEEN ? AND ?
                 WHERE e.tenant_id = ?
                 GROUP BY e.department_id
                """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject("department_id", UUID.class), Map.of(
                "people", rs.getInt("people"), "attended", rs.getInt("attended"), "late", rs.getInt("late"),
                "arrival", Math.round(rs.getDouble("arrival") * 10.0) / 10.0)), mon, fri, tenant);
        return out;
    }

    @Test void theBreakdownMatchesThePunches() {
        Breakdown b = controller().breakdown(null, mon, fri, "department");
        Map<UUID, Map<String, Object>> sql = bySql();

        assertEquals(3, b.people());
        assertEquals(2, b.groups().size());
        int attendedAll = 0, workingAll = 0;
        for (Group g : b.groups()) {
            Map<String, Object> want = sql.get(g.id());
            int people = (int) want.get("people"), attended = (int) want.get("attended");
            int working = people * 5; // Monday to Friday, no holidays, no leave
            assertEquals(people, g.people());
            assertEquals(working, g.current().workingDays(), g.name());
            assertEquals(attended, g.current().attendedDays(), g.name());
            assertEquals(want.get("late"), g.current().lateDays(), g.name());
            assertEquals(working - attended, g.current().absentDays(), g.name());
            assertEquals(Math.round(1000.0 * attended / working) / 10.0, g.current().ratePct(), g.name());
            assertEquals(want.get("arrival"), g.current().avgArrivalMinutes(), g.name());
            attendedAll += attended;
            workingAll += working;
        }
        assertEquals("QA insights A", b.groups().stream().filter(g -> g.id().equals(deptA)).findFirst().orElseThrow().name());
        assertEquals(attendedAll, b.overall().attendedDays());
        assertEquals(Math.round(1000.0 * attendedAll / workingAll) / 10.0, b.overall().ratePct());
        // The five days before: nobody had started punching, so nothing to count.
        assertEquals(LocalDate.of(2026, 7, 29), b.previousFrom());
        assertEquals(LocalDate.of(2026, 8, 2), b.previousTo());
        assertEquals(0, b.previous().attendedDays());
    }

    @Test void punctualityMatchesThePunches() {
        Punctuality p = controller().punctuality(null, mon, fri);

        assertEquals(1, p.rows().size(), "one person was late");
        var row = p.rows().get(0);
        assertEquals("Late Insights", row.employeeName());
        assertEquals(2, row.lateDays());
        assertEquals(32.5, row.avgDelayMinutes(), "25 and 40 minutes after 09:00");
        assertEquals(2, p.totals().lateDays());
    }

    @Test void theNewQueriesRunAgainstTheSchema() {
        List<UUID> ids = team.stream().map(Employee::getId).toList();
        // Roster day facts.
        List<Map<String, Object>> rows = named.queryForList(TeamScheduleController.SQL,
                Map.of("from", mon, "to", mon.plusDays(6), "tenant", tenant, "employees", ids));
        assertEquals(3 * 7, rows.size(), "one row per person per day");
        rows.forEach(TeamScheduleController::dayFacts);
        long off = rows.stream().filter(r -> Boolean.TRUE.equals(r.get("weeklyOff"))).count();
        assertEquals(3 * 2, off, "Saturday and Sunday");
        assertTrue(rows.stream().allMatch(r -> "QA General".equals(r.get("shiftName")) && r.get("onLeave") == null));
        // People per shift.
        Map<UUID, Integer> counts = new ShiftHeadcount(named).byShift(company);
        assertEquals(Map.of(shift, 3), counts);
        // The overtime list with a company rule (the table must exist: V143.54): 45 extra minutes on Monday
        // count as 15 past a 30-minute rule; 20 on Tuesday are all inside it and drop out.
        UUID early = team.get(0).getId();
        jdbc.update("UPDATE attendance.records SET check_out_at = check_in_at + interval '9 hours', overtime_minutes = ? "
                + "WHERE employee_id = ? AND attendance_date = ?", 45, early, mon);
        jdbc.update("UPDATE attendance.records SET check_out_at = check_in_at + interval '8 hours 30 minutes', overtime_minutes = ? "
                + "WHERE employee_id = ? AND attendance_date = ?", 20, early, mon.plusDays(1));
        jdbc.update("INSERT INTO attendance.overtime_rules(tenant_id, company_id, counts_after_minutes) VALUES (?, ?, 30)", tenant, company);
        try {
            String where = " WHERE r.tenant_id=:tenant AND r.employee_id IN (:employees) AND r.attendance_date BETWEEN :from AND :to AND r.overtime_minutes>0 AND r.check_out_at IS NOT NULL";
            OvertimeRules rules = new OvertimeRules(jdbc);
            assertTrue(rules.tableReady());
            assertTrue(rules.countsAfterInUse(tenant));
            assertEquals(30, rules.forCompany(tenant, company).countsAfterMinutes());
            Map<String, Object> list = new OvertimeController(mock(TeamEmployeeScope.class), jdbc, named, mock(OvertimeReasons.class), rules)
                    .listCounted(Map.of("tenant", tenant, "employees", ids, "from", mon, "to", fri, "offset", 0), where);
            assertEquals(1L, list.get("totalElements"));
            @SuppressWarnings("unchecked") Map<String, Object> row = ((List<Map<String, Object>>) list.get("content")).get(0);
            assertEquals(45, ((Number) row.get("minutes")).intValue(), "the stored minutes");
            assertEquals(15, ((Number) row.get("countedMinutes")).intValue(), "the part that counts");
            assertEquals("PENDING", row.get("status"));
            assertEquals("QA General", row.get("shiftName"));
        } finally {
            jdbc.update("DELETE FROM attendance.overtime_rules WHERE tenant_id = ?", tenant);
        }
    }
}
