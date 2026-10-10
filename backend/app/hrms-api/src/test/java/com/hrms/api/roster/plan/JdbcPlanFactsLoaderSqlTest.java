package com.hrms.api.roster.plan;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.roster.BaselineSchedule;
import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link JdbcPlanFactsLoader} and {@link PlannerPeople} against the real schema (V143.106 applied): each kind of
 * fact from real rows, another tenant's rows never read, the roster being edited left out of "other rosters".
 *
 * <p>Opt-in, like the other {@code *SqlTest}s: only against a migrated, disposable database
 * ({@code RECOVERY_TEST_JDBC_URL}). Everything lives in two random tenants and is deleted afterwards.
 */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class JdbcPlanFactsLoaderSqlTest {

    private final DriverManagerDataSource source = new DriverManagerDataSource(
            System.getenv("RECOVERY_TEST_JDBC_URL"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
    private final JdbcTemplate jdbc = new JdbcTemplate(source);

    private final UUID tenant = UUID.randomUUID(), otherTenant = UUID.randomUUID();
    private final UUID company = UUID.randomUUID(), dept = UUID.randomUUID(), dept2 = UUID.randomUUID();
    private final UUID designation = UUID.randomUUID(), branch = UUID.randomUUID();
    private final UUID shiftA = UUID.randomUUID(), shiftC = UUID.randomUUID(), deletedShift = UUID.randomUUID();
    private final UUID ravi = UUID.randomUUID(), sita = UUID.randomUUID(), exited = UUID.randomUUID(), stranger = UUID.randomUUID();
    private final UUID september = UUID.randomUUID(), hvac = UUID.randomUUID(), editing = UUID.randomUUID();
    private final LocalDate sep30 = LocalDate.of(2026, 9, 30), oct1 = LocalDate.of(2026, 10, 1), oct31 = LocalDate.of(2026, 10, 31);

    /** A baseline that answers "A, weekly off on Sunday" for everyone, and records what it was asked. */
    private final List<Object[]> baselineCalls = new ArrayList<>();
    private final BaselineSchedule baseline = (t, ids, from, to) -> {
        baselineCalls.add(new Object[]{t, List.copyOf(ids), from, to});
        Map<UUID, List<BaselineDay>> out = new HashMap<>();
        for (UUID id : ids) {
            List<BaselineDay> days = new ArrayList<>();
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                days.add(new BaselineDay(d, shiftA, d.getDayOfWeek() == java.time.DayOfWeek.SUNDAY));
            }
            out.put(id, days);
        }
        return out;
    };

    @BeforeEach void seed() {
        TenantContext.setTenantId(tenant);
        jdbc.update("INSERT INTO org.companies(id, tenant_id, name) VALUES (?, ?, 'QA roster facts')", company, tenant);
        jdbc.update("INSERT INTO org.branches(id, tenant_id, company_id, name) VALUES (?, ?, ?, 'QA Building 1')", branch, tenant, company);
        jdbc.update("INSERT INTO hrms.departments(id, tenant_id, company_id, name) VALUES (?, ?, ?, 'QA Technical'), (?, ?, ?, 'QA Stores')",
                dept, tenant, company, dept2, tenant, company);
        jdbc.update("INSERT INTO hrms.designations(id, tenant_id, company_id, title) VALUES (?, ?, ?, 'QA Technician')",
                designation, tenant, company);
        jdbc.update("INSERT INTO attendance.shift_policies(id, tenant_id, company_id, name, code, shift_type, start_time, end_time, is_active) VALUES "
                        + "(?, ?, ?, 'QA Morning', 'QA', 'FIXED', '06:00', '14:00', TRUE), "
                        + "(?, ?, ?, 'QA Night', 'QC', 'NIGHT', '22:00', '06:00', TRUE), "
                        + "(?, ?, ?, 'QA Old', 'QO', 'FIXED', '09:00', '17:00', FALSE)",
                shiftA, tenant, company, shiftC, tenant, company, deletedShift, tenant, company);
        employee(ravi, tenant, "Ravi", "ACTIVE", dept, branch, LocalDate.of(2026, 1, 5), null);
        employee(sita, tenant, "Sita", "NOTICE_PERIOD", dept2, null, null, LocalDate.of(2026, 10, 20));
        employee(exited, tenant, "Gone", "EXITED", dept, null, null, LocalDate.of(2026, 8, 31));
        employee(stranger, otherTenant, "Stranger", "ACTIVE", null, null, null, null);
        jdbc.update("INSERT INTO settings.holiday_calendar(id, tenant_id, company_id, year, holiday_date, holiday_name, is_active) VALUES "
                        + "(?, ?, ?, 2026, '2026-10-02', 'QA Gandhi Jayanti', TRUE), (?, ?, ?, 2026, '2026-10-20', 'QA Removed', FALSE)",
                UUID.randomUUID(), tenant, company, UUID.randomUUID(), tenant, company);
        UUID casual = UUID.randomUUID(), compOff = UUID.randomUUID();
        jdbc.update("INSERT INTO leave_mgmt.leave_types(id, tenant_id, company_id, name, code, category) VALUES "
                        + "(?, ?, ?, 'QA Casual', 'QACL', 'CASUAL'), (?, ?, ?, 'QA Comp off', 'QACO', 'COMPENSATORY')",
                casual, tenant, company, compOff, tenant, company);
        leave(ravi, casual, "2026-10-05", "2026-10-06", false, "APPROVED");
        leave(ravi, compOff, "2026-10-09", "2026-10-09", false, "APPROVED");
        leave(ravi, casual, "2026-10-12", "2026-10-12", true, "APPROVED");
        leave(ravi, casual, "2026-10-14", "2026-10-14", false, "PENDING");
        // Published rosters: September (ends the day before), "HVAC" planning Ravi on 3 Oct, and the roster being edited.
        roster(september, "QA September", "2026-09-01", "2026-09-30",
                "{\"pattern\":[{\"shiftPolicyId\":\"" + shiftA + "\",\"weeklyOff\":false},{\"shiftPolicyId\":null,\"weeklyOff\":true}],"
                        + "\"weeklyOffMode\":\"FIXED\",\"staggerMode\":\"SPREAD\",\"repeats\":true}");
        roster(hvac, "QA HVAC", "2026-10-01", "2026-10-31", "{}");
        roster(editing, "QA October", "2026-10-01", "2026-10-31", "{}");
        jdbc.update("INSERT INTO attendance.roster_members(tenant_id, roster_id, employee_id, rotation_offset) VALUES (?, ?, ?, 1)",
                tenant, september, ravi);
        day(ravi, sep30, september, "SHIFT", shiftC);
        day(ravi, LocalDate.of(2026, 10, 3), hvac, "SHIFT", shiftA);
        day(ravi, LocalDate.of(2026, 10, 4), editing, "WO", null);
        jdbc.update("INSERT INTO attendance.roster_settings(tenant_id, company_id, min_rest_minutes) VALUES (?, ?, 600)", tenant, company);
    }

    private void employee(UUID id, UUID t, String name, String status, UUID d, UUID b, LocalDate joined, LocalDate left) {
        jdbc.update("INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, "
                        + "employment_status, date_of_joining, last_working_day, department_id, designation_id, branch_id) "
                        + "VALUES (?, ?, ?, ?, ?, 'QA', 'FULL_TIME', ?, ?, ?, ?, ?, ?)",
                id, t, company, "QAR-" + id.toString().substring(0, 8), name, status, joined, left, d,
                t.equals(tenant) ? designation : null, b);
    }

    private void leave(UUID emp, UUID type, String from, String to, boolean half, String status) {
        jdbc.update("INSERT INTO leave_mgmt.leave_requests(id, tenant_id, employee_id, leave_type_id, start_date, end_date, half_day, total_days, status) "
                        + "VALUES (?, ?, ?, ?, CAST(? AS date), CAST(? AS date), ?, 1, ?)",
                UUID.randomUUID(), tenant, emp, type, from, to, half, status);
    }

    private void roster(UUID id, String name, String from, String to, String config) {
        jdbc.update("INSERT INTO attendance.rosters(id, tenant_id, company_id, name, period_type, start_date, end_date, status, config, version) "
                        + "VALUES (?, ?, ?, ?, 'MONTH', CAST(? AS date), CAST(? AS date), 'PUBLISHED', CAST(? AS jsonb), 1)",
                id, tenant, company, name, from, to, config);
    }

    private void day(UUID emp, LocalDate d, UUID roster, String kind, UUID shift) {
        jdbc.update("INSERT INTO attendance.schedule_days(tenant_id, employee_id, work_date, company_id, kind, shift_policy_id, roster_id, roster_version, source) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ROSTER')", tenant, emp, d, company, kind, shift, roster);
    }

    @AfterEach void cleanup() {
        for (UUID t : List.of(tenant, otherTenant)) {
            jdbc.update("DELETE FROM attendance.schedule_days WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM attendance.roster_settings WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM attendance.rosters WHERE tenant_id = ?", t);   // members cascade
            jdbc.update("DELETE FROM leave_mgmt.leave_requests WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM leave_mgmt.leave_types WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM settings.holiday_calendar WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM hrms.employees WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM attendance.shift_policies WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM hrms.designations WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM hrms.departments WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM org.branches WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM org.companies WHERE tenant_id = ?", t);
        }
        TenantContext.clear();
    }

    @Test
    void everyFactComesFromItsRows() {
        JdbcPlanFactsLoader loader = new JdbcPlanFactsLoader(jdbc, baseline, new ObjectMapper().findAndRegisterModules());
        PlanFacts f = loader.load(tenant, company, editing, List.of(ravi, sita, stranger), sep30, oct31);

        assertEquals(company, f.companyId());
        assertEquals(Set.of(shiftA, shiftC, deletedShift), f.shifts().keySet());
        assertFalse(f.shifts().get(deletedShift).active());
        assertTrue(f.shifts().get(shiftC).night());
        assertEquals("QC", f.shifts().get(shiftC).displayCode());

        assertEquals(Set.of(ravi, sita), f.people().keySet(), "another tenant's person is not found");
        PlanFacts.Person r = f.people().get(ravi);
        assertEquals("Ravi QA", r.name());
        assertEquals("QA Technician", r.designationName());
        assertEquals("QA Technical", r.departmentName());
        assertEquals("QA Building 1", r.branchName());
        assertEquals(LocalDate.of(2026, 1, 5), r.joinedOn());
        assertEquals(LocalDate.of(2026, 10, 20), f.people().get(sita).lastWorkingDay());

        assertEquals(Map.of(LocalDate.of(2026, 10, 2), "QA Gandhi Jayanti"), f.holidays(), "inactive holidays are left out");

        Map<LocalDate, PlanFacts.Leave> leave = f.leave().get(ravi);
        assertEquals(new PlanFacts.Leave(OverlayType.L, "QA Casual", false), leave.get(LocalDate.of(2026, 10, 5)));
        assertEquals(new PlanFacts.Leave(OverlayType.L, "QA Casual", false), leave.get(LocalDate.of(2026, 10, 6)));
        assertEquals(OverlayType.COFF, leave.get(LocalDate.of(2026, 10, 9)).type());
        assertTrue(leave.get(LocalDate.of(2026, 10, 12)).halfDay());
        assertNull(leave.get(LocalDate.of(2026, 10, 14)), "pending leave is not shown");

        Map<LocalDate, PlanFacts.OtherDay> other = f.otherRosterDays().get(ravi);
        assertEquals(Set.of(sep30, LocalDate.of(2026, 10, 3)), other.keySet(), "the roster being edited is left out");
        assertEquals(new PlanFacts.OtherDay(hvac, "QA HVAC", "SHIFT", shiftA), other.get(LocalDate.of(2026, 10, 3)));

        assertEquals(1, f.previousRosters().size());
        PlanFacts.PreviousRoster prev = f.previousRosters().get(0);
        assertEquals(september, prev.id());
        assertEquals(WeeklyOffMode.FIXED, prev.weeklyOffMode());
        assertEquals(2, prev.pattern().size());
        assertTrue(prev.pattern().get(1).weeklyOff());
        assertEquals(Map.of(ravi, 1), prev.offsets());

        assertEquals(600, f.minRestMinutes());
        assertEquals("QA Stores", f.departmentNames().get(dept2));
        assertEquals("QA Technician", f.designationNames().get(designation));
        assertEquals("QA Building 1", f.branchNames().get(branch));

        // The baseline is read back to September's start, for "Continue from" a Fixed roster.
        Object[] call = baselineCalls.get(0);
        assertEquals(LocalDate.of(2026, 9, 1), call[2]);
        assertEquals(oct31, call[3]);
        assertTrue(f.baseline().get(ravi).get(LocalDate.of(2026, 10, 4)).weeklyOff(), "4 Oct 2026 is a Sunday");

        // Planning on these facts works end to end.
        assertNotNull(RosterPlanner.plan(new com.hrms.api.roster.RosterContract.PlanRequest(oct1, oct31, null, null, editing,
                null, List.of(new com.hrms.api.roster.RosterContract.MemberIn(ravi, 0)), List.of(), List.of(), true, true), f));
    }

    @Test
    void withoutARosterIdEveryPublishedDayIsAnotherRosters() {
        JdbcPlanFactsLoader loader = new JdbcPlanFactsLoader(jdbc, baseline, new ObjectMapper());
        PlanFacts f = loader.load(tenant, company, null, List.of(ravi), sep30, oct31);
        assertEquals(3, f.otherRosterDays().get(ravi).size());
        assertEquals(List.of(september), f.previousRosters().stream().map(PlanFacts.PreviousRoster::id).toList(),
                "September is the only roster ending on 30 Sep");
    }

    @Test
    void peopleInScopeWithTheirPublishedRosters() {
        PlannerPeople people = new PlannerPeople(jdbc);
        List<PlannerPerson> all = people.list(tenant, company, null, null, null, oct1, oct31);
        assertEquals(List.of("Ravi QA", "Sita QA"), all.stream().map(PlannerPerson::name).toList(),
                "the exited person and the other tenant's are left out");
        PlannerPerson r = all.get(0);
        assertEquals(Set.of("QA HVAC", "QA October"), Set.copyOf(r.otherRosters().stream().map(o -> o.name()).toList()));
        assertEquals("QA Technician", r.designationName());
        assertEquals(List.of("Ravi QA"), people.list(tenant, company, dept, null, null, oct1, oct31).stream()
                .map(PlannerPerson::name).toList());
        assertEquals(List.of("Ravi QA"), people.list(tenant, company, null, branch, null, oct1, oct31).stream()
                .map(PlannerPerson::name).toList());
        assertEquals(List.of("Sita QA"), people.list(tenant, company, null, null, Set.of(dept2), oct1, oct31).stream()
                .map(PlannerPerson::name).toList(), "a department planner's own departments");
        assertTrue(people.list(tenant, company, null, null, Set.of(), oct1, oct31).isEmpty());
        assertEquals(List.of("Ravi QA"), people.list(tenant, company, null, null, null, LocalDate.of(2026, 10, 21), oct31)
                .stream().map(PlannerPerson::name).toList(), "Sita's last day is 20 Oct");
    }
}
