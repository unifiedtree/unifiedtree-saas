package com.hrms.api.attendance;

import com.hrms.attendance.client.FaceRecognitionClient;
import com.hrms.attendance.mapper.AttendanceMapper;
import com.hrms.attendance.policy.AttendancePolicyService;
import com.hrms.attendance.policy.EffectiveDay;
import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.attendance.repository.AttendanceCorrectionRequestRepository;
import com.hrms.attendance.repository.AttendanceEventLogRepository;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import com.hrms.attendance.repository.GeoFenceZoneRepository;
import com.hrms.attendance.service.AttendanceCalendar;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.employee.entity.Employee;
import com.hrms.leave.mapper.LeaveBalanceMapperImpl;
import com.hrms.leave.mapper.LeaveRequestMapperImpl;
import com.hrms.leave.repository.HolidayCalendarRepository;
import com.hrms.leave.repository.LeaveBalanceRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import com.hrms.leave.repository.LeaveTypeRepository;
import com.hrms.leave.service.LeaveService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Characterization of every copy of "which shift does this person have on this date" (shift-ot GAP-MAP §2.2), of the
 * attendance and leave weekly-off rules that read the database (§2.3), and of the night-shift date the lookups are
 * asked about (§2.4), on {@link ShiftCharacterizationFixture}'s data. Written BEFORE the copies were replaced by one
 * resolver: the answers are compared with golden files taken from the old code, so the replacement must give the same
 * answer for every person, date and caller. A few rules the copies differ on are also stated outright below.
 *
 * <p>Opt-in, like {@link AttendanceInsightsSqlTest}: only against a migrated, disposable database
 * (RECOVERY_TEST_JDBC_URL), as a role that sees every tenant's rows. Everything lives in two random tenants and is
 * deleted afterwards.
 *
 * <p>E10's two assignments start on the same day. The copies that never broke that tie (they took whichever row the
 * database returned first) are left out of the golden files for E10 and only checked to give one of the two.
 */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class EffectiveShiftCharacterizationSqlTest {

    private final ShiftCharacterizationFixture f = new ShiftCharacterizationFixture();
    private final NamedParameterJdbcTemplate named = new NamedParameterJdbcTemplate(f.source);

    @BeforeEach void seed() {
        TenantContext.setTenantId(f.tenant);
        com.hrms.core.tenant.TenantContext.setTenantId(f.tenant);
        f.seed();
        // A night shift: in at 22:20 on the 10th, out at 06:30 on the 11th; and in after midnight on the 11th.
        f.record("E2", "2026-08-10", "22:20", "2026-08-11", "06:30", 8.17, 70);
        f.record("E2", "2026-08-11", "00:30", "2026-08-11", "07:00", 6.5, 65);
        f.record("E3", "2026-08-05", "10:05", "2026-08-05", "20:30", 10.42, 61);
        f.record("E4", "2026-08-05", "07:10", "2026-08-05", "19:00", 11.83, 90);
        f.record("E5", "2026-08-05", "09:00", "2026-08-05", "19:00", 10.0, 120);
        f.record("E7", "2026-08-05", "10:20", "2026-08-05", "20:30", 10.17, 80);
        f.record("E10", "2026-08-03", "09:00", "2026-08-03", "18:15", 9.25, 75);
        f.record("E12", "2026-08-05", "09:00", "2026-08-05", "19:00", 10.0, 60);
        f.record("E1", "2026-08-04", "09:25", "2026-08-04", "18:00", 8.58, 0);
        f.record("E8", "2026-08-05", "10:00", "2026-08-05", "18:00", 8.0, 0);
        f.record("E1", "2026-08-07", "09:00", "2026-08-07", "17:00", 8.0, 0);
        f.record("E11", "2026-08-05", "11:30", "2026-08-05", "20:00", 8.5, 30);
    }

    @AfterEach void cleanup() {
        try {
            f.cleanup();
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    @SuppressWarnings("unchecked")
    private AttendanceService attendance(boolean companyPolicy) {
        AttendanceService s = new AttendanceService(mock(AttendanceRecordRepository.class), mock(AttendanceEventLogRepository.class),
                mock(AttendanceCorrectionRequestRepository.class), mock(GeoFenceZoneRepository.class), mock(FaceRecognitionClient.class),
                mock(GeoValidationService.class), mock(KafkaTemplate.class), mock(AttendanceMapper.class),
                mock(ApplicationEventPublisher.class), 0.92, false, false);
        ReflectionTestUtils.setField(s, "jdbcTemplate", f.jdbc);
        if (companyPolicy) ReflectionTestUtils.setField(s, "attendancePolicies", new AttendancePolicyService(f.jdbc));
        return s;
    }

    private static void line(StringBuilder out, String what, String person, LocalDate day, Object value) {
        out.append(what).append(' ').append(person).append(day == null ? "" : " " + day).append(" = ")
                .append(ShiftCharacterizationFixture.show(value)).append('\n');
    }

    /** Everyone but E10, in fixture order. */
    private List<String> untied() {
        List<String> out = new ArrayList<>(f.people.keySet());
        out.remove("E10");
        return out;
    }

    // ── AttendanceService: late marks, my day / app home, weekly target, overtime threshold, dashboard ─────────────

    @Test void attendanceServiceLookups() throws Exception {
        AttendanceService plain = attendance(false), withPolicy = attendance(true);
        StringBuilder out = new StringBuilder();
        for (String p : untied()) {
            UUID id = f.id(p);
            for (LocalDate d : f.days()) {
                line(out, "profile", p, d, plain.getShiftProfile(id, d));
                line(out, "dailyTargetHours", p, d, ReflectionTestUtils.invokeMethod(plain, "lookupDailyTargetHours", id, d));
                line(out, "overtimeThresholdHours", p, d, ReflectionTestUtils.invokeMethod(plain, "overtimeThresholdHours", id, d));
                line(out, "lateThreshold", p, d, ReflectionTestUtils.invokeMethod(plain, "lateThresholdFor", id, d));
                line(out, "lateThresholdWithCompanyPolicy", p, d, ReflectionTestUtils.invokeMethod(withPolicy, "lateThresholdFor", id, d));
            }
        }
        List<UUID> ids = f.everyoneBut("E10");
        for (LocalDate d : f.days()) {
            Map<UUID, AttendanceService.ShiftWindow> windows = plain.getShiftWindowsForEmployees(ids, d);
            Map<UUID, java.time.Instant> ends = plain.getShiftEndInstantsForEmployees(ids, d);
            for (String p : untied()) {
                line(out, "window", p, d, windows.get(f.id(p)));
                line(out, "shiftEnd", p, d, ends.get(f.id(p)));
            }
        }
        Map<UUID, Set<Integer>> today = plain.weeklyOffSetsFor(ids);
        for (String p : untied()) line(out, "weeklyOffToday", p, null, today.get(f.id(p)));
        ShiftCharacterizationFixture.assertGolden("attendance-service.txt", f.labelled(out.toString()));
    }

    @Test void attendanceServiceStatedRules() {
        AttendanceService s = attendance(false);
        LocalDate wed = LocalDate.of(2026, 8, 5);
        // An archived shift is skipped: the assignment before it, still open, applies (late marks and overtime).
        assertEquals("09:00", s.getShiftProfile(f.id("E4"), wed).scheduledStart());
        // Two open rows: the later start wins; a flexible shift with core hours is late from core start, grace 0.
        AttendanceService.ShiftProfile flex = s.getShiftProfile(f.id("E3"), wed);
        assertEquals("10:00", flex.scheduledStart());
        assertEquals(0, flex.graceMinutes());
        // No tenant condition: the other tenant's row is the latest start, so it applies.
        assertEquals("11:00", s.getShiftProfile(f.id("E11"), wed).scheduledStart());
        // A night shift's overtime threshold is its length (22:00 to 06:00 = 8 h), more than its 7.5 working hours.
        assertEquals(8.0, (double) ReflectionTestUtils.invokeMethod(s, "overtimeThresholdHours", f.id("E2"), LocalDate.of(2026, 8, 10)));
        // No shift: 8 hours.
        assertEquals(8.0, (double) ReflectionTestUtils.invokeMethod(s, "overtimeThresholdHours", f.id("E5"), wed));
        // The dashboard's batch lookup: the latest start is chosen first; its shift must be the assignment's tenant's,
        // else the person has no window at all that day (E12), not the older one.
        Map<UUID, AttendanceService.ShiftWindow> w = s.getShiftWindowsForEmployees(f.ids("E11", "E12"), wed);
        assertEquals("QA Other Tenant", w.get(f.id("E11")).shiftName());
        assertFalse(w.containsKey(f.id("E12")));
        // A night shift ends the next morning.
        assertEquals(java.time.Instant.parse("2026-08-11T00:30:00Z"),
                s.getShiftEndInstantsForEmployees(f.ids("E2"), LocalDate.of(2026, 8, 10)).get(f.id("E2")));
        // E10: two rows from the same day; these lookups never broke the tie.
        Set<String> tie = Set.of("09:00", "22:00");
        assertTrue(tie.contains(s.getShiftProfile(f.id("E10"), wed).scheduledStart()));
        String tieWindow = s.getShiftWindowsForEmployees(f.ids("E10"), wed).get(f.id("E10")).shiftName();
        assertTrue(Set.of("QA General", "QA Night").contains(tieWindow));
    }

    // ── EffectiveDayStatusService: day status (payroll and reports read it too) ───────────────────────────────────

    @Test void dayStatus() throws Exception {
        EffectiveDayStatusService service = new EffectiveDayStatusService(f.jdbc, new AttendancePolicyService(f.jdbc));
        Map<UUID, Map<LocalDate, EffectiveDay>> all = service.effectiveStatuses(f.everyoneBut("E10"),
                ShiftCharacterizationFixture.FROM, ShiftCharacterizationFixture.TO);
        StringBuilder out = new StringBuilder();
        for (String p : untied()) {
            Map<LocalDate, EffectiveDay> days = all.get(f.id(p));
            for (LocalDate d : f.days()) line(out, "day", p, d, days == null ? null : days.get(d));
        }
        ShiftCharacterizationFixture.assertGolden("day-status.txt", f.labelled(out.toString()));
        // The night punch after midnight is filed on the 11th and judged against the 11th's shift.
        EffectiveDay afterMidnight = all.get(f.id("E2")).get(LocalDate.of(2026, 8, 11));
        assertEquals("QA Night", afterMidnight.shiftName());
        assertEquals(java.time.Instant.parse("2026-08-11T16:30:00Z"), afterMidnight.expectedStart());
        // E10's day: one of its two shifts.
        EffectiveDay tie = service.effectiveStatus(f.id("E10"), LocalDate.of(2026, 8, 3));
        assertTrue(Set.of("QA General", "QA Night").contains(tie.shiftName()));
    }

    // ── AttendanceCalendar: the attendance weekly-off rule ───────────────────────────────────────────────────────

    @Test void attendanceWeeklyOffs() throws Exception {
        List<UUID> ids = f.everyoneBut("E10");
        StringBuilder out = new StringBuilder();
        for (LocalDate d : f.days()) {
            Map<UUID, Set<Integer>> shift = AttendanceCalendar.shiftWeeklyOffDays(f.jdbc, ids, d);
            Map<UUID, Set<Integer>> resolved = AttendanceCalendar.resolveWeeklyOffDays(f.jdbc, ids, d);
            for (String p : untied()) {
                line(out, "shiftWeeklyOffs", p, d, shift.get(f.id(p)));
                line(out, "weeklyOffs", p, d, resolved.get(f.id(p)));
            }
        }
        Map<UUID, Set<Integer>> companyStep = AttendanceCalendar.weeklyOffDays(f.jdbc, ids);
        for (String p : untied()) line(out, "ownElseCompany", p, null, companyStep.get(f.id(p)));
        ShiftCharacterizationFixture.assertGolden("attendance-weekly-offs.txt", f.labelled(out.toString()));
        LocalDate wed = LocalDate.of(2026, 8, 5);
        // Own days win; then the shift's (an archived shift is skipped, so E4 gets General's); then the company's;
        // then Saturday and Sunday (company C's list is empty).
        Map<UUID, Set<Integer>> r = AttendanceCalendar.resolveWeeklyOffDays(f.jdbc, ids, wed);
        assertEquals(Set.of(6, 7), r.get(f.id("E1")));
        assertEquals(Set.of(3), r.get(f.id("E8")));
        assertEquals(Set.of(6), r.get(f.id("E4")));
        assertEquals(Set.of(7), r.get(f.id("E5")));
        assertEquals(Set.of(5, 6), r.get(f.id("E7")));
        assertEquals(Set.of(6, 7), r.get(f.id("E13")));
    }

    // ── Team schedule, overtime list, people per shift (hrms-api SQL) ─────────────────────────────────────────────

    @Test void teamSchedule() throws Exception {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        List<Employee> everyone = new ArrayList<>();
        for (String p : f.people.keySet()) everyone.add(f.employee(p));
        when(scope.resolve(any(), isNull(), isNull(), eq(false))).thenReturn(everyone);
        List<Map<String, Object>> rows = new TeamScheduleController(scope, named)
                .schedule(null, ShiftCharacterizationFixture.FROM, ShiftCharacterizationFixture.TO, null);
        StringBuilder out = new StringBuilder();
        for (Map<String, Object> row : rows) out.append(ShiftCharacterizationFixture.show(row)).append('\n');
        ShiftCharacterizationFixture.assertGolden("team-schedule.txt", f.labelled(out.toString()));
        // The latest assignment of the tenant whatever its shift: an archived shift is still named (E4), the other
        // tenant's row is not seen (E11), a shift of another tenant leaves the day without one (E12), and of two rows
        // from the same day the one created later wins (E10).
        Map<String, Map<String, Object>> wed = new HashMap<>();
        for (Map<String, Object> row : rows) {
            if (LocalDate.of(2026, 8, 5).equals(((java.sql.Date) row.get("date")).toLocalDate())) {
                wed.put(f.labelled(String.valueOf(row.get("employeeId"))), row);
            }
        }
        assertEquals("QA Archived", wed.get("E4").get("shiftName"));
        assertEquals(false, wed.get("E4").get("weeklyOff"));
        assertEquals("QA General", wed.get("E11").get("shiftName"));
        assertNull(wed.get("E12").get("shiftName"));
        assertNull(wed.get("E12").get("since"));
        assertEquals("QA Night", wed.get("E10").get("shiftName"));
        assertEquals("2026-08-05", wed.get("E3").get("since"));
        assertEquals(true, wed.get("E8").get("weeklyOff"), "the shift's weekly off (Wednesday)");
    }

    @Test void overtimeList() throws Exception {
        OvertimeController ot = new OvertimeController(mock(TeamEmployeeScope.class), f.jdbc, named, mock(OvertimeReasons.class),
                new OvertimeRules(f.jdbc));
        String where = " WHERE r.tenant_id=:tenant AND r.employee_id IN (:employees) AND r.attendance_date BETWEEN :from AND :to AND r.overtime_minutes>0 AND r.check_out_at IS NOT NULL";
        Map<String, Object> params = Map.of("tenant", f.tenant, "employees", f.everyoneBut(), "from", ShiftCharacterizationFixture.FROM,
                "to", ShiftCharacterizationFixture.TO, "offset", 0);
        Map<String, Object> list = ot.listCounted(params, where, false);
        StringBuilder out = new StringBuilder("totalElements = " + list.get("totalElements") + "\n");
        @SuppressWarnings("unchecked") List<Map<String, Object>> content = (List<Map<String, Object>>) list.get("content");
        for (Map<String, Object> row : content) out.append(ShiftCharacterizationFixture.show(row)).append('\n');
        ShiftCharacterizationFixture.assertGolden("overtime-list.txt", f.labelled(out.toString()));
        Map<String, Map<String, Object>> byPerson = new HashMap<>();
        for (Map<String, Object> row : content) byPerson.put(f.labelled(row.get("employeeId") + "@" + row.get("date")), row);
        assertEquals("QA Archived", byPerson.get("E4@2026-08-05").get("shiftName"));
        assertEquals("22:00", byPerson.get("E2@2026-08-10").get("shiftStart"));
        assertEquals("06:00", byPerson.get("E2@2026-08-10").get("shiftEnd"));
        assertNull(byPerson.get("E5@2026-08-05").get("shiftName"));
        assertNull(byPerson.get("E12@2026-08-05").get("shiftName"));
        assertEquals("QA Night", byPerson.get("E10@2026-08-03").get("shiftName"));
    }

    @Test void peoplePerShiftToday() throws Exception {
        ShiftHeadcount headcount = new ShiftHeadcount(named);
        StringBuilder out = new StringBuilder();
        for (UUID company : List.of(f.companyA, f.companyB, f.companyC)) {
            Map<UUID, Integer> counts = headcount.byShift(company);
            Map<String, Integer> labelled = new java.util.TreeMap<>();
            counts.forEach((shift, n) -> labelled.put(f.labelled(shift.toString()), n));
            out.append(f.labelled(company.toString())).append(" = ").append(labelled).append('\n');
        }
        ShiftCharacterizationFixture.assertGolden("people-per-shift.txt", out.toString());
        // The assignment's own shift id, whatever the shift: E4 on the archived one, E12 on the other tenant's.
        Map<UUID, Integer> a = headcount.byShift(f.companyA);
        assertEquals(1, a.get(f.archived));
        assertEquals(1, a.get(f.xShift));
    }

    // ── Leave day counting: the company's weekly offs only ────────────────────────────────────────────────────────

    @Test void leaveWeeklyOffs() throws Exception {
        @SuppressWarnings("unchecked") KafkaTemplate<String, Object> kafka = mock(KafkaTemplate.class);
        LeaveService leave = new LeaveService(mock(LeaveTypeRepository.class), mock(LeaveBalanceRepository.class),
                mock(LeaveRequestRepository.class), mock(HolidayCalendarRepository.class), kafka, new LeaveRequestMapperImpl(),
                new LeaveBalanceMapperImpl(), f.jdbc, mock(ApplicationEventPublisher.class), false);
        StringBuilder out = new StringBuilder();
        for (UUID company : java.util.Arrays.asList(f.companyA, f.companyB, f.companyC, UUID.randomUUID(), null)) {
            Set<Integer> offs = ReflectionTestUtils.invokeMethod(leave, "resolveOffDays", company);
            out.append(company == null ? "null" : f.labelled(company.toString())).append(" = ")
                    .append(ShiftCharacterizationFixture.show(offs)).append('\n');
        }
        ShiftCharacterizationFixture.assertGolden("leave-weekly-offs.txt", out.toString().replaceAll("\\?id", "UNKNOWN_COMPANY"));
        // Never the person's own days nor a shift's: E1's own 6,7 and Flex's Wednesday don't count for leave.
        assertEquals(Set.of(7), ReflectionTestUtils.invokeMethod(leave, "resolveOffDays", f.companyA));
    }
}
