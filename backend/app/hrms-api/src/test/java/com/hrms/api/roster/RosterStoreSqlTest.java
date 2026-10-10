package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RosterSource;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.api.roster.RosterStore.Cell;
import com.hrms.api.roster.RosterStore.DayChange;
import com.hrms.api.roster.RosterStore.Header;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The shift-planning tables (V143.106) and permissions (V143.107) against the real schema: the store
 * round-trips a roster, its working copy and its published days; one plan per person and date (the
 * primary key); a draft's delete takes its working copy with it; the table checks; another tenant
 * sees nothing (row-level security, as the app's role); the built-in roles hold the new permissions
 * and the owner holds every one (the start-up invariant).
 *
 * <p>Opt-in, like {@code AttendanceInsightsSqlTest}: only against a migrated, disposable database
 * (RECOVERY_TEST_JDBC_URL, as a role that sees every tenant). Everything lives in random tenants and
 * is deleted afterwards.
 */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class RosterStoreSqlTest {

    private final DriverManagerDataSource source = new DriverManagerDataSource(
            System.getenv("RECOVERY_TEST_JDBC_URL"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
    private final JdbcTemplate jdbc = new JdbcTemplate(source);
    private final RosterStore store = new RosterStore(jdbc, RosterFakes.JSON);

    private final UUID tenant = UUID.randomUUID(), otherTenant = UUID.randomUUID(), company = UUID.randomUUID();
    private final UUID shiftA = UUID.randomUUID(), shiftB = UUID.randomUUID();
    private final UUID ravi = UUID.randomUUID(), sita = UUID.randomUUID();
    private final LocalDate oct12 = LocalDate.of(2026, 10, 12);
    private final Actor hr = new Actor(UUID.randomUUID(), null, "QA Roster HR", company, true, Set.of(), true);

    @BeforeEach
    void seed() {
        jdbc.update("INSERT INTO attendance.shift_policies(id, tenant_id, company_id, name, code, shift_type, start_time, end_time) "
                + "VALUES (?, ?, ?, 'QA Morning', 'A', 'FIXED', '06:00', '14:00'), (?, ?, ?, 'QA Evening', 'B', 'FIXED', '14:00', '22:00')",
                shiftA, tenant, company, shiftB, tenant, company);
        for (UUID e : List.of(ravi, sita)) {
            jdbc.update("INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, "
                    + "employment_status, date_of_joining) VALUES (?, ?, ?, ?, ?, 'Roster', 'FULL_TIME', 'ACTIVE', '2026-01-01')",
                    e, tenant, company, "QAR-" + e.toString().substring(0, 8), e.equals(ravi) ? "Ravi" : "Sita");
        }
    }

    @AfterEach
    void cleanup() {
        for (UUID t : List.of(tenant, otherTenant)) {
            for (String table : RosterTables.TABLES) {
                if (!table.endsWith("rotation_template_days")) jdbc.update("DELETE FROM " + table + " WHERE tenant_id = ?", t);
            }
            jdbc.update("DELETE FROM attendance.rotation_template_days WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM hrms.employees WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM attendance.shift_policies WHERE tenant_id = ?", t);
        }
    }

    private static RosterConfig config() {
        return new RosterConfig(null, List.of(new PatternDay(null, true)), true, WeeklyOffMode.FIXED, StaggerMode.SAME, null, List.of(), List.of(""));
    }

    private UUID roster(UUID t, String name) {
        return store.insert(t, company, new RosterStore.Draft(name, PeriodType.MONTH, LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31),
                null, null, config()), RosterSource.PLANNER, hr);
    }

    private static DayChange add(UUID e, LocalDate d, String kind, UUID shift) {
        return new DayChange(e, d, ChangeKind.ADDED, null, null, kind, shift);
    }

    @Test
    void aRosterItsWorkingCopyAndItsPublishedDaysRoundTrip() {
        UUID id = roster(tenant, "QA October");
        UUID designation = UUID.randomUUID();
        store.replaceWorkingCopy(tenant, id, List.of(new MemberIn(sita, 3), new MemberIn(ravi, 0)),
                List.of(new StaffingIn(designation, shiftA, 2)),
                List.of(new Cell(ravi, oct12, "SHIFT", shiftA, false), new Cell(ravi, oct12.plusDays(1), "WO", null, true),
                        new Cell(sita, oct12, "SHIFT", shiftB, false)));
        Header h = store.header(tenant, id, true);
        assertEquals("QA October", h.name());
        assertEquals(RosterStatus.DRAFT, h.status());
        assertEquals(0, h.version());
        assertEquals(2, h.memberCount());
        assertEquals(WeeklyOffMode.FIXED, h.config().weeklyOffMode(), "the wizard's choices come back");
        assertEquals(List.of(""), h.config().designationIds());
        assertEquals(List.of(new MemberIn(sita, 3), new MemberIn(ravi, 0)), store.members(tenant, id), "display order kept");
        assertEquals(List.of(new StaffingIn(designation, shiftA, 2)), store.staffing(tenant, id));
        assertEquals(3, store.cells(tenant, id).size());
        assertTrue(store.cells(tenant, id).stream().anyMatch(c -> c.edited() && "WO".equals(c.kind())));
        assertEquals(1, store.list(tenant, company, oct12, oct12, null).size());
        assertEquals(0, store.list(tenant, company, oct12, oct12, Set.of(UUID.randomUUID())).size());
        assertEquals(1, store.update(tenant, id, 0, new RosterStore.Draft("QA October v2", PeriodType.MONTH, LocalDate.of(2026, 10, 1),
                LocalDate.of(2026, 10, 31), null, null, config()), false, hr));
        assertEquals(0, store.update(tenant, id, 0, new RosterStore.Draft("stale", PeriodType.MONTH, LocalDate.of(2026, 10, 1),
                LocalDate.of(2026, 10, 31), null, null, config()), false, hr), "a stale lock writes nothing");

        // publish v1: three days
        List<DayChange> refused = store.applyChanges(tenant, company, id, 1, "ROSTER", List.of(add(ravi, oct12, "SHIFT", shiftA),
                add(ravi, oct12.plusDays(1), "WO", null), add(sita, oct12, "SHIFT", shiftB)), hr, "first");
        assertTrue(refused.isEmpty());
        store.markPublished(tenant, id, 1, hr);
        Header p = store.header(tenant, id, false);
        assertEquals(RosterStatus.PUBLISHED, p.status());
        assertEquals(1, p.version());
        assertEquals(2, p.lockVersion());
        assertEquals("QA Roster HR", p.publishedByName());
        assertEquals(3, store.rosterDays(tenant, id, oct12, false).size());
        assertEquals(1, store.rosterDays(tenant, id, oct12.plusDays(1), false).size());
        assertEquals(company, jdbc.queryForObject("SELECT company_id FROM attendance.schedule_days WHERE employee_id = ? AND work_date = ?",
                UUID.class, ravi, oct12));

        // republish v2: Ravi's 12th A → B, Sita's 12th removed
        store.applyChanges(tenant, company, id, 2, "ROSTER", List.of(
                new DayChange(ravi, oct12, ChangeKind.CHANGED, "SHIFT", shiftA, "SHIFT", shiftB),
                new DayChange(sita, oct12, ChangeKind.REMOVED, "SHIFT", shiftB, null, null)), hr, "second");
        List<RosterStore.Day> days = store.rosterDays(tenant, id, oct12, false);
        assertEquals(2, days.size());
        RosterStore.Day r12 = days.stream().filter(d -> d.employeeId().equals(ravi) && d.date().equals(oct12)).findFirst().orElseThrow();
        assertEquals(shiftB, r12.shiftPolicyId());
        assertEquals(2, r12.rosterVersion());
        assertEquals("QA October v2", r12.rosterName());
        List<RosterStore.HistoryRow> history = store.history(tenant, id, null);
        assertEquals(5, history.size(), "one history row per change");
        assertEquals(2, store.history(tenant, id, sita).size());
        assertEquals("Sita Roster", store.history(tenant, id, sita).get(0).employeeName());
        assertTrue(history.stream().anyMatch(x -> x.change() == ChangeKind.REMOVED && "second".equals(x.note())));
        assertEquals(1, store.days(tenant, List.of(ravi, sita), oct12, oct12).size());
    }

    @Test
    void onePlanPerPersonAndDate() {
        UUID first = roster(tenant, "QA HVAC"), second = roster(tenant, "QA Electrical");
        assertTrue(store.applyChanges(tenant, company, first, 1, "ROSTER", List.of(add(ravi, oct12, "SHIFT", shiftA)), hr, null).isEmpty());
        List<DayChange> refused = store.applyChanges(tenant, company, second, 1, "ROSTER",
                List.of(add(ravi, oct12, "SHIFT", shiftB), add(ravi, oct12.plusDays(1), "SHIFT", shiftB)), hr, null);
        assertEquals(List.of(oct12), refused.stream().map(DayChange::date).toList(), "the day another roster holds is refused");
        assertEquals(first, store.otherRosterDays(tenant, List.of(ravi), oct12, oct12, second, true).get(0).rosterId());
        assertThrows(DuplicateKeyException.class, () -> jdbc.update("INSERT INTO attendance.schedule_days (tenant_id, employee_id, work_date, "
                + "company_id, kind, shift_policy_id, roster_id, roster_version, source) VALUES (?, ?, ?, ?, 'WO', NULL, ?, 1, 'ROSTER')",
                tenant, ravi, oct12, company, second));
    }

    @Test
    void deletingADraftTakesItsWorkingCopyWithIt() {
        UUID id = roster(tenant, "QA Draft");
        store.replaceWorkingCopy(tenant, id, List.of(new MemberIn(ravi, 0)), List.of(new StaffingIn(UUID.randomUUID(), shiftA, 1)),
                List.of(new Cell(ravi, oct12, "SHIFT", shiftA, false)));
        assertTrue(store.deleteDraft(tenant, id));
        for (String t : List.of("roster_members", "roster_staffing", "roster_cells")) {
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM attendance." + t + " WHERE roster_id = ?", Integer.class, id), t);
        }
        UUID published = roster(tenant, "QA Published");
        store.markPublished(tenant, published, 1, hr);
        assertFalse(store.deleteDraft(tenant, published), "a published roster is kept");
        assertNotNull(store.header(tenant, published, false));
    }

    @Test
    void theTablesRefuseBadRows() {
        UUID id = roster(tenant, "QA Checks");
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("INSERT INTO attendance.roster_cells (tenant_id, roster_id, "
                + "employee_id, work_date, kind) VALUES (?, ?, ?, ?, 'SHIFT')", tenant, id, ravi, oct12), "a SHIFT needs its shift");
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("INSERT INTO attendance.roster_cells (tenant_id, roster_id, "
                + "employee_id, work_date, kind, shift_policy_id) VALUES (?, ?, ?, ?, 'WO', ?)", tenant, id, ravi, oct12, shiftA), "a WO has none");
        assertThrows(DataIntegrityViolationException.class, () -> store.insert(tenant, company, new RosterStore.Draft("QA Long", PeriodType.RANGE,
                LocalDate.of(2026, 10, 1), LocalDate.of(2026, 12, 2), null, null, config()), RosterSource.PLANNER, hr), "at most 62 days");
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("INSERT INTO attendance.rotation_templates (tenant_id, company_id, "
                + "name, cycle_length) VALUES (?, ?, 'QA 63', 63)", tenant, company), "at most 62 days in a pattern");
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("INSERT INTO attendance.roster_settings (tenant_id, company_id, "
                + "min_rest_minutes) VALUES (?, ?, 1441)", tenant, company), "rest up to 24 hours");
        jdbc.update("INSERT INTO attendance.rotation_templates (tenant_id, company_id, name, cycle_length) VALUES (?, ?, 'QA Same', 1)", tenant, company);
        assertThrows(DuplicateKeyException.class, () -> jdbc.update("INSERT INTO attendance.rotation_templates (tenant_id, company_id, name, "
                + "cycle_length) VALUES (?, ?, 'qa same', 1)", tenant, company), "a pattern name is unique in the company, any case");
        Boolean historyUpdate = jdbc.queryForObject("SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app') "
                + "THEN has_table_privilege('ut_app', 'attendance.schedule_day_history', 'UPDATE') END", Boolean.class);
        if (historyUpdate != null) assertFalse(historyUpdate, "the history is append-only for the app");
    }

    /** As the app's role, with row-level security: the tenant sees its own rows, another tenant none. */
    @Test
    void anotherTenantSeesNothing() {
        UUID id = roster(tenant, "QA RLS");
        store.replaceWorkingCopy(tenant, id, List.of(new MemberIn(ravi, 0)), List.of(), List.of(new Cell(ravi, oct12, "SHIFT", shiftA, false)));
        store.applyChanges(tenant, company, id, 1, "ROSTER", List.of(add(ravi, oct12, "SHIFT", shiftA)), hr, null);
        jdbc.update("INSERT INTO attendance.roster_settings (tenant_id, company_id) VALUES (?, ?)", tenant, company);

        SingleConnectionDataSource app;
        try {
            app = new SingleConnectionDataSource(System.getenv("RECOVERY_TEST_JDBC_URL"),
                    System.getenv().getOrDefault("RECOVERY_TEST_APP_USER", "ut_app"),
                    System.getenv().getOrDefault("RECOVERY_TEST_APP_PASSWORD", "local_recovery_only"), true);
            app.getConnection().isValid(5);
        } catch (Exception e) {
            Assumptions.abort("the app role can't sign in here: " + e.getMessage());
            return;
        }
        try {
            JdbcTemplate asApp = new JdbcTemplate(app);
            asApp.queryForObject("SELECT set_config('app.tenant_id', ?, false)", String.class, tenant.toString());
            assertEquals(1, asApp.queryForObject("SELECT count(*) FROM attendance.rosters WHERE id = ?", Integer.class, id));
            assertEquals(1, asApp.queryForObject("SELECT count(*) FROM attendance.schedule_days WHERE roster_id = ?", Integer.class, id));
            asApp.queryForObject("SELECT set_config('app.tenant_id', ?, false)", String.class, otherTenant.toString());
            List<String> seen = new ArrayList<>();
            for (String table : RosterTables.TABLES) {
                Integer n = asApp.queryForObject("SELECT count(*) FROM " + table + " WHERE tenant_id = ?", Integer.class, tenant);
                if (n != null && n > 0) seen.add(table + "=" + n);
            }
            assertEquals(List.of(), seen, "another tenant sees none of the tenant's rows");
            org.springframework.dao.DataAccessException refused = assertThrows(org.springframework.dao.DataAccessException.class,
                    () -> asApp.update("INSERT INTO attendance.roster_settings (tenant_id, company_id) VALUES (?, ?)", tenant, UUID.randomUUID()),
                    "nor writes in its name");
            assertTrue(String.valueOf(refused.getMostSpecificCause().getMessage()).contains("row-level security"), refused.getMessage());
        } finally {
            app.destroy();
        }
    }

    /** V143.107: the built-in roles hold the codes they should, and OWNER holds every permission (the start-up check). */
    @Test
    void theNewPermissionsAreOnTheBuiltInRoles() {
        List<String> plan = jdbc.queryForList("SELECT r.code FROM rbac.role_permissions rp JOIN rbac.roles r ON r.id = rp.role_id "
                + "WHERE r.tenant_id IS NULL AND rp.permission_code = 'attendance.roster.plan' ORDER BY r.code", String.class);
        List<String> publish = jdbc.queryForList("SELECT r.code FROM rbac.role_permissions rp JOIN rbac.roles r ON r.id = rp.role_id "
                + "WHERE r.tenant_id IS NULL AND rp.permission_code = 'attendance.roster.publish' ORDER BY r.code", String.class);
        for (String role : List.of("OWNER", "SUPER_ADMIN", "ADMIN")) {
            assertTrue(plan.contains(role), role + " plans");
            assertTrue(publish.contains(role), role + " publishes");
        }
        for (String role : List.of("COMPANY_ADMIN", "HR_MANAGER")) {
            if (jdbc.queryForObject("SELECT count(*) FROM rbac.roles WHERE tenant_id IS NULL AND code = ?", Integer.class, role) == 0) continue;
            assertTrue(plan.contains(role) && publish.contains(role), role);
        }
        if (jdbc.queryForObject("SELECT count(*) FROM rbac.roles WHERE tenant_id IS NULL AND code = 'DEPT_MANAGER'", Integer.class) > 0) {
            assertTrue(plan.contains("DEPT_MANAGER"), "department heads plan");
            assertFalse(publish.contains("DEPT_MANAGER"), "only HR/Admin publish");
        }
        assertFalse(plan.contains("EMPLOYEE") || publish.contains("EMPLOYEE"));
        assertFalse(plan.contains("MANAGER"), "the plain manager role doesn't plan");
        assertEquals("attendance", jdbc.queryForObject("SELECT module FROM rbac.permissions WHERE code = 'attendance.roster.publish'", String.class));
        assertEquals("HIGH", jdbc.queryForObject("SELECT risk_level FROM rbac.permissions WHERE code = 'attendance.roster.publish'", String.class));
        List<String> ownerMissing = jdbc.queryForList("SELECT p.code FROM rbac.permissions p WHERE p.module <> 'platform' AND NOT EXISTS ("
                + "SELECT 1 FROM rbac.role_permissions rp WHERE rp.role_id = '00000000-0000-0000-0000-000000000010'::uuid "
                + "AND rp.permission_code = p.code)", String.class);
        assertEquals(List.of(), ownerMissing, "OwnerPermissionInvariantCheck would refuse to start");
    }
}
