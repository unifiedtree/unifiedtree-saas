package com.hrms.api.roster;

import com.hrms.api.attendance.ShiftHeadcount;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.attendance.TeamScheduleController;
import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.RosterSource;
import com.hrms.api.roster.RosterStore.DayChange;
import com.hrms.attendance.client.FaceRecognitionClient;
import com.hrms.attendance.mapper.AttendanceMapper;
import com.hrms.attendance.policy.AttendancePolicyService;
import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.attendance.repository.AttendanceCorrectionRequestRepository;
import com.hrms.attendance.repository.AttendanceEventLogRepository;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import com.hrms.attendance.repository.GeoFenceZoneRepository;
import com.hrms.attendance.service.AttendanceCalendar;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Publishing a roster changes nothing in attendance in Phase 1 (design §1.9, guarantee G1): with a
 * published roster that gives people a weekly off on a working weekday, another shift, a night shift
 * and a shift on their usual day off, and with the company's "rosters drive attendance" switch even
 * turned ON, every attendance answer is exactly what it was without the roster, and again after the
 * roster is gone. The answers compared: the shift in force for late marks and my day, the dashboard's
 * shift windows and ends, the overtime threshold, the attendance weekly offs, each day's status, the
 * team schedule, the people per shift, and the stored records.
 *
 * <p>The design runs this on the resolver branch's characterization fixture and goldens; that branch
 * is not on this one's base, so the fixture is this test's own and the "goldens" are the answers
 * taken before the roster exists. Opt-in: a migrated, disposable database (RECOVERY_TEST_JDBC_URL)
 * with V143.106. Everything lives in a random tenant and is deleted afterwards.
 */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class RosterDoesNotChangeAttendanceSqlTest {

    private final DriverManagerDataSource source = new DriverManagerDataSource(
            System.getenv("RECOVERY_TEST_JDBC_URL"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
    private final JdbcTemplate jdbc = new JdbcTemplate(source);
    private final NamedParameterJdbcTemplate named = new NamedParameterJdbcTemplate(source);
    private final RosterStore store = new RosterStore(jdbc, RosterFakes.JSON);

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID();
    private final UUID general = UUID.randomUUID(), evening = UUID.randomUUID(), night = UUID.randomUUID();
    private final UUID e1 = UUID.randomUUID(), e2 = UUID.randomUUID(), e3 = UUID.randomUUID(), e4 = UUID.randomUUID();
    private final List<UUID> people = List.of(e1, e2, e3, e4);
    private final List<Employee> team = new ArrayList<>();
    // Monday 3 to Sunday 16 August 2026.
    private final LocalDate mon = LocalDate.of(2026, 8, 3), sun2 = mon.plusDays(13);
    private final Actor hr = new Actor(UUID.randomUUID(), null, "QA No-change", company, true, Set.of(), true);

    @BeforeEach
    void seed() {
        TenantContext.setTenantId(tenant);
        com.hrms.core.tenant.TenantContext.setTenantId(tenant);
        jdbc.update("INSERT INTO attendance.shift_policies(id, tenant_id, company_id, name, code, shift_type, start_time, end_time, grace_period_minutes, working_hours_per_day) "
                + "VALUES (?, ?, ?, 'QA General', 'G', 'FIXED', '09:00', '18:00', 10, 9), (?, ?, ?, 'QA Evening', 'B', 'FIXED', '14:00', '22:00', 10, 8), "
                + "(?, ?, ?, 'QA Night', 'C', 'NIGHT', '22:00', '06:00', 15, 8)",
                general, tenant, company, evening, tenant, company, night, tenant, company);
        for (UUID e : people) {
            jdbc.update("INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, "
                            + "employment_status, date_of_joining, weekly_off_days) VALUES (?, ?, ?, ?, 'QA', ?, 'FULL_TIME', 'ACTIVE', '2026-06-01', ?)",
                    e, tenant, company, "QAN-" + e.toString().substring(0, 8), "NoChange-" + people.indexOf(e), e.equals(e4) ? null : "6,7");
            Employee x = new Employee();
            x.setId(e);
            x.setFirstName("QA");
            x.setLastName("NoChange-" + people.indexOf(e));
            x.setCompanyId(company);
            team.add(x);
        }
        // e1, e2: General since June; e3: Evening since June, Night from the 10th; e4: no assignment (8-hour rule, company weekend).
        assign(e1, general, "2026-06-01", null);
        assign(e2, general, "2026-06-01", null);
        assign(e3, evening, "2026-06-01", "2026-08-09");
        assign(e3, night, "2026-08-10", null);
        // Punches: on time, late, overtime, a night shift, a weekend.
        record(e1, "2026-08-03", "09:05", "2026-08-03", "19:30");
        record(e1, "2026-08-05", "09:40", "2026-08-05", "18:00");
        record(e2, "2026-08-06", "08:00", "2026-08-06", "20:00");
        record(e3, "2026-08-10", "22:20", "2026-08-11", "06:30");
        record(e4, "2026-08-08", "10:00", "2026-08-08", "19:00");
        jdbc.update("INSERT INTO settings.holiday_calendar(id, tenant_id, company_id, year, holiday_date, holiday_name, holiday_type) "
                + "VALUES (?, ?, ?, 2026, '2026-08-15', 'QA Independence Day', 'NATIONAL')", UUID.randomUUID(), tenant, company);
        UUID leaveType = UUID.randomUUID();
        jdbc.update("INSERT INTO leave_mgmt.leave_types(id, tenant_id, company_id, name, code) VALUES (?, ?, ?, 'QA Casual', ?)",
                leaveType, tenant, company, "QAC" + tenant.toString().substring(0, 6));
        jdbc.update("INSERT INTO leave_mgmt.leave_requests(id, tenant_id, employee_id, leave_type_id, start_date, end_date, total_days, status) "
                + "VALUES (?, ?, ?, ?, '2026-08-12', '2026-08-13', 2, 'APPROVED')", UUID.randomUUID(), tenant, e2, leaveType);
    }

    private void assign(UUID e, UUID shift, String from, String to) {
        jdbc.update("INSERT INTO attendance.employee_shift_assignments(id, tenant_id, employee_id, shift_policy_id, effective_from, effective_to) "
                + "VALUES (?, ?, ?, ?, ?::date, ?::date)", UUID.randomUUID(), tenant, e, shift, from, to);
    }

    private void record(UUID e, String inDate, String in, String outDate, String out) {
        jdbc.update("INSERT INTO attendance.records(id, tenant_id, employee_id, company_id, attendance_date, check_in_at, check_out_at) "
                        + "VALUES (?, ?, ?, ?, ?::date, (?::date + ?::time) AT TIME ZONE 'Asia/Kolkata', (?::date + ?::time) AT TIME ZONE 'Asia/Kolkata')",
                UUID.randomUUID(), tenant, e, company, inDate, inDate, in, outDate, out);
    }

    @AfterEach
    void cleanup() {
        try {
            deleteRoster();
            jdbc.update("DELETE FROM leave_mgmt.leave_requests WHERE tenant_id = ?", tenant);
            jdbc.update("DELETE FROM leave_mgmt.leave_types WHERE tenant_id = ?", tenant);
            jdbc.update("DELETE FROM settings.holiday_calendar WHERE tenant_id = ?", tenant);
            jdbc.update("DELETE FROM attendance.records WHERE tenant_id = ?", tenant);
            jdbc.update("DELETE FROM attendance.employee_shift_assignments WHERE tenant_id = ?", tenant);
            jdbc.update("DELETE FROM attendance.shift_policies WHERE tenant_id = ?", tenant);
            jdbc.update("DELETE FROM hrms.employees WHERE tenant_id = ?", tenant);
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    private void deleteRoster() {
        jdbc.update("DELETE FROM attendance.schedule_day_history WHERE tenant_id = ?", tenant);
        jdbc.update("DELETE FROM attendance.schedule_days WHERE tenant_id = ?", tenant);
        jdbc.update("DELETE FROM attendance.rosters WHERE tenant_id = ?", tenant);
        jdbc.update("DELETE FROM attendance.roster_settings WHERE tenant_id = ?", tenant);
    }

    @SuppressWarnings("unchecked")
    private AttendanceService attendance() {
        AttendanceService s = new AttendanceService(mock(AttendanceRecordRepository.class), mock(AttendanceEventLogRepository.class),
                mock(AttendanceCorrectionRequestRepository.class), mock(GeoFenceZoneRepository.class), mock(FaceRecognitionClient.class),
                mock(GeoValidationService.class), mock(KafkaTemplate.class), mock(AttendanceMapper.class),
                mock(ApplicationEventPublisher.class), 0.92, false, false);
        ReflectionTestUtils.setField(s, "jdbcTemplate", jdbc);
        ReflectionTestUtils.setField(s, "attendancePolicies", new AttendancePolicyService(jdbc));
        return s;
    }

    /** Every attendance answer for the fixture, one line each. */
    private String answers() {
        StringBuilder out = new StringBuilder();
        AttendanceService att = attendance();
        for (LocalDate d = mon; !d.isAfter(sun2); d = d.plusDays(1)) {
            for (UUID e : people) {
                out.append("profile ").append(people.indexOf(e)).append(' ').append(d).append(" = ").append(att.getShiftProfile(e, d)).append('\n');
                out.append("otThreshold ").append(people.indexOf(e)).append(' ').append(d).append(" = ")
                        .append((Object) ReflectionTestUtils.invokeMethod(att, "overtimeThresholdHours", e, d)).append('\n');
            }
            out.append("windows ").append(d).append(" = ").append(new TreeMap<>(att.getShiftWindowsForEmployees(people, d))).append('\n');
            out.append("ends ").append(d).append(" = ").append(new TreeMap<>(att.getShiftEndInstantsForEmployees(people, d))).append('\n');
            out.append("offs ").append(d).append(" = ").append(new TreeMap<>(AttendanceCalendar.resolveWeeklyOffDays(jdbc, people, d))).append('\n');
        }
        EffectiveDayStatusService status = new EffectiveDayStatusService(jdbc, new AttendancePolicyService(jdbc));
        out.append("status = ").append(new TreeMap<>(status.effectiveStatuses(people, mon, sun2))).append('\n');
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        when(scope.resolve(any(), isNull(), isNull(), anyBoolean())).thenReturn(team);
        Jwt jwt = RosterFakes.jwt(UUID.randomUUID(), UUID.randomUUID(), "attendance.team.read");
        out.append("team = ").append(new TeamScheduleController(scope, named).schedule(jwt, mon, mon.plusDays(13), false)).append('\n');
        out.append("headcount = ").append(new TreeMap<>(new ShiftHeadcount(named).byShift(company))).append('\n');
        out.append("records = ").append(jdbc.queryForList("SELECT employee_id, attendance_date, attendance_status::text, work_hours, overtime_minutes, "
                + "late_by_minutes FROM attendance.records WHERE tenant_id = ? ORDER BY employee_id, attendance_date", tenant)).append('\n');
        return out.toString();
    }

    /** A published roster that disagrees with every assignment, and the company's switch turned ON. */
    private void publishDisagreeingRoster() {
        UUID roster = store.insert(tenant, company, new RosterStore.Draft("QA No-change August", PeriodType.RANGE, mon, sun2, null, null, RosterStore.normalize(null)),
                RosterSource.PLANNER, hr);
        List<DayChange> days = new ArrayList<>();
        for (LocalDate d = mon; !d.isAfter(sun2); d = d.plusDays(1)) {
            int dow = d.getDayOfWeek().getValue();
            days.add(add(e1, d, dow == 3 ? "WO" : "SHIFT", dow == 3 ? null : evening));         // a WO every Wednesday, Evening otherwise
            days.add(add(e2, d, "SHIFT", night));                                                // nights every day, weekends too
            days.add(add(e3, d, dow >= 6 ? "SHIFT" : "WO", dow >= 6 ? general : null));          // General on weekends, off on weekdays
            if (dow == 6) days.add(add(e4, d, "SHIFT", general));                                // a shift on the usual day off
        }
        assertTrue(store.applyChanges(tenant, company, roster, 1, "ROSTER", days, hr, "QA").isEmpty());
        store.markPublished(tenant, roster, 1, hr);
        jdbc.update("INSERT INTO attendance.roster_settings(tenant_id, company_id, min_rest_minutes, rosters_drive_attendance) VALUES (?, ?, 480, TRUE)",
                tenant, company);
    }

    private static DayChange add(UUID e, LocalDate d, String kind, UUID shift) {
        return new DayChange(e, d, ChangeKind.ADDED, null, null, kind, shift);
    }

    @Test
    void aPublishedRosterChangesNoAttendanceAnswer() {
        String before = answers();
        publishDisagreeingRoster();
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM attendance.schedule_days WHERE tenant_id = ?", Integer.class, tenant) > 40,
                "the roster is really there");
        assertEquals(before, answers(), "with the roster published and the switch on");
        deleteRoster();
        assertEquals(before, answers(), "after the roster is gone");
    }
}
