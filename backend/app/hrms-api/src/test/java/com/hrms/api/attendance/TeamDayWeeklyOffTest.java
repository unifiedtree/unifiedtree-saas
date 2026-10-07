package com.hrms.api.attendance;

import com.hrms.attendance.dto.StaffStatusResponse;
import com.hrms.attendance.dto.TeamDashboardResponse;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.policy.EffectiveDay;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A day's roster on a weekly off (audit, 4 Oct): the muster roll, Daily Logs
 * and analytics asked for the day and got nobody, because the roster leaves out
 * whoever has the day off. With includeWeeklyOff they are listed as weekly-off
 * rows and still never counted; with includeSelf a company-wide viewer is on
 * their own register. Without either flag the roster is what it always was (the
 * mobile app reads it).
 */
class TeamDayWeeklyOffTest {

    /** Sunday 4 Oct 2026. */
    private static final LocalDate SUNDAY = LocalDate.of(2026, 10, 4);
    private static final UUID COMPANY = UUID.randomUUID();

    private final AttendanceService attendance = mock(AttendanceService.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final WorkforceDepartmentRepository departments = mock(WorkforceDepartmentRepository.class);
    private final LeaveRequestRepository leave = mock(LeaveRequestRepository.class);
    private AttendanceController controller;

    // me: the viewer (Sat/Sun off). asha: Sat/Sun off, no punch. bala: Sat/Sun off, came in anyway.
    // chitra: Monday off, so Sunday is a working day, no punch.
    private final Employee me = person("Zed", "Viewer"), asha = person("Asha", "Rao"), bala = person("Bala", "Iyer"), chitra = person("Chitra", "Das");

    @BeforeEach
    void setUp() {
        controller = new AttendanceController(attendance, mock(GeoValidationService.class), mock(AttendanceContextResolver.class),
                employees, departments, leave);
        when(employees.findById(me.getId())).thenReturn(Optional.of(me));
        when(employees.findActiveByCompany(COMPANY)).thenReturn(List.of(me, asha, bala, chitra));
        when(employees.findByManagerId(me.getId())).thenReturn(List.of(asha, bala, chitra));
        when(attendance.weeklyOffSetsFor(anyList())).thenReturn(Map.of(
                me.getId(), Set.of(6, 7), asha.getId(), Set.of(6, 7), bala.getId(), Set.of(6, 7), chitra.getId(), Set.of(1)));
        AttendanceRecord punch = new AttendanceRecord();
        punch.setEmployeeId(bala.getId());
        punch.setAttendanceDate(SUNDAY);
        punch.setCheckInAt(Instant.parse("2026-10-04T04:00:00Z"));
        when(attendance.getRecordsForEmployeesOnDate(anyList(), eq(SUNDAY))).thenReturn(List.of(punch));
        when(leave.findEmployeeIdsOnApprovedLeave(any(), eq(SUNDAY))).thenReturn(List.of());
    }

    @Test void withoutTheFlagsTheRosterIsUnchanged() {
        TeamDashboardResponse day = controller.teamDay(admin(), SUNDAY, null, false);
        assertEquals(List.of("Bala Iyer", "Chitra Das"), names(day));
        assertEquals(1, day.counts().present());
        assertEquals(1, day.counts().notMarked());
        assertEquals(1, day.counts().absent());
    }

    @Test void peopleOnTheirWeeklyOffAreListedButNeverCounted() {
        TeamDashboardResponse plain = controller.teamDay(admin(), SUNDAY, null, false);
        TeamDashboardResponse day = controller.teamDay(admin(), SUNDAY, null, false, true, false);
        assertEquals(List.of("Asha Rao", "Bala Iyer", "Chitra Das"), names(day));
        StaffStatusResponse ashaRow = row(day, asha);
        assertEquals(EffectiveDay.WEEKLY_OFF, ashaRow.effectiveStatus());
        assertNull(ashaRow.checkInAt());
        // The one who came in on her day off is a worked day, as before.
        assertEquals("PRESENT", row(day, bala).status());
        // The tiles count exactly who they counted before: no weekly off is "not marked" or absent.
        assertEquals(plain.counts(), day.counts());
    }

    @Test void aCompanyWideViewerIsOnTheirOwnRegister() {
        TeamDashboardResponse day = controller.teamDay(admin(), SUNDAY, null, false, true, true);
        assertEquals(List.of("Asha Rao", "Bala Iyer", "Chitra Das", "Zed Viewer"), names(day));
        assertEquals(EffectiveDay.WEEKLY_OFF, row(day, me).effectiveStatus());
        // On a working day of theirs the viewer is counted like anyone else.
        when(attendance.getRecordsForEmployeesOnDate(anyList(), eq(SUNDAY.plusDays(1)))).thenReturn(List.of());
        TeamDashboardResponse monday = controller.teamDay(admin(), SUNDAY.plusDays(1), null, false, true, true);
        assertTrue(names(monday).contains("Zed Viewer"));
        assertEquals(3, monday.counts().notMarked(), "me, asha, bala; chitra is off on Mondays");
    }

    @Test void aManagersTeamNeverIncludesTheManager() {
        TeamDashboardResponse day = controller.teamDay(manager(), SUNDAY, null, false, true, true);
        assertEquals(List.of("Asha Rao", "Bala Iyer", "Chitra Das"), names(day));
        assertFalse(names(day).contains("Zed Viewer"));
    }

    /**
     * The admin dashboard's chart counts the same people as its tiles (5 Oct): with includeSelf a
     * company-wide viewer is on every day of the trend; without it, or for a manager, as before.
     */
    @Test void theTrendCountsACompanyWideViewerOnlyWithIncludeSelf() {
        LocalDate monday = SUNDAY.plusDays(1);
        AttendanceController.DailyAttendanceCounts plain = controller.dashboardTrend(monday, monday, null, false, null, admin()).getBody().get(0);
        AttendanceController.DailyAttendanceCounts withSelf = controller.dashboardTrend(monday, monday, null, false, true, admin()).getBody().get(0);
        AttendanceController.DailyAttendanceCounts team = controller.dashboardTrend(monday, monday, null, false, true, manager()).getBody().get(0);
        // asha and bala work Mondays (chitra is off); the viewer too, once asked for.
        assertEquals(2, plain.scheduled());
        assertEquals(3, withSelf.scheduled());
        assertEquals(3, withSelf.notMarked());
        assertEquals(2, team.scheduled(), "a manager's team never includes the manager");
    }

    /**
     * Production, 7 Oct 2026: HR set someone ABSENT on their weekly off, and no tile counted it, because the
     * roster keeps a person on their day off only if they punched. A reviewer's status now counts as a punch
     * does, on the day's tiles and in the trend; someone merely off that day still is not counted.
     */
    @Test void aReviewersStatusOnAWeeklyOffIsCountedOnTheTilesAndInTheTrend() {
        com.hrms.attendance.policy.EffectiveDayStatusService policy = mock(com.hrms.attendance.policy.EffectiveDayStatusService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "effectiveDays", policy);
        Map<UUID, EffectiveDay> sunday = Map.of(
                me.getId(), effective(me, EffectiveDay.WEEKLY_OFF, null, false),
                asha.getId(), effective(asha, EffectiveDay.ABSENT, null, true),              // set by HR on her day off
                bala.getId(), effective(bala, EffectiveDay.PRESENT, Instant.parse("2026-10-04T04:00:00Z"), false),
                chitra.getId(), effective(chitra, EffectiveDay.ABSENT, null, false));
        when(policy.effectiveStatuses(any(), eq(SUNDAY), eq(SUNDAY))).thenAnswer(inv -> {
            java.util.Collection<UUID> ids = inv.getArgument(0);
            Map<UUID, Map<LocalDate, EffectiveDay>> out = new java.util.HashMap<>();
            for (UUID id : ids) if (sunday.containsKey(id)) out.put(id, Map.of(SUNDAY, sunday.get(id)));
            return out;
        });

        TeamDashboardResponse day = controller.teamDay(admin(), SUNDAY, null, false, true, true);
        assertEquals(List.of("Asha Rao", "Bala Iyer", "Chitra Das", "Zed Viewer"), names(day));
        assertEquals("ABSENT", row(day, asha).status());
        assertEquals(1, day.counts().present(), "bala, who came in on his day off");
        assertEquals(2, day.counts().absent(), "chitra, and asha whom HR marked absent on her weekly off");
        assertEquals(EffectiveDay.WEEKLY_OFF, row(day, me).effectiveStatus(), "the viewer is only off: listed, not counted");

        // The mobile app's roster (no flags) counts her too.
        TeamDashboardResponse plain = controller.teamDay(admin(), SUNDAY, null, false);
        assertEquals(List.of("Asha Rao", "Bala Iyer", "Chitra Das"), names(plain));
        assertEquals(2, plain.counts().absent());

        when(attendance.getRecordsForEmployeesBetween(anyList(), eq(SUNDAY), eq(SUNDAY))).thenReturn(List.of());
        AttendanceController.DailyAttendanceCounts trend = controller.dashboardTrend(SUNDAY, SUNDAY, null, false, true, admin()).getBody().get(0);
        assertEquals(2, trend.absent(), "the trend counts the same people as the tiles");
        assertEquals(1, trend.scheduled(), "expected in: chitra only; a status on a day off does not make it a working day");
    }

    @Test void withoutThePolicyServiceAWeeklyOffRowStillSaysWeeklyOff() {
        StaffStatusResponse bare = new StaffStatusResponse(asha.getId(), "E1", "Asha Rao", null, null, null, null, "NOT_MARKED",
                null, null, null, null, null, false, null, false, null, null, null, null, null, null, false, false, false,
                false, false, null, null);
        StaffStatusResponse off = AttendanceController.asWeeklyOff(bare);
        assertEquals(EffectiveDay.WEEKLY_OFF, off.effectiveStatus());
        assertEquals("Weekly off.", off.statusNote());
        assertEquals("Asha Rao", off.fullName());
        // The policy's own word (on leave over the weekend, a holiday) is kept.
        StaffStatusResponse onLeave = new StaffStatusResponse(asha.getId(), "E1", "Asha Rao", null, null, null, null, "NOT_MARKED",
                null, null, null, null, null, false, null, true, null, null, null, null, EffectiveDay.ON_LEAVE, "On approved leave.", false, false, false,
                false, false, null, null);
        assertEquals(EffectiveDay.ON_LEAVE, AttendanceController.asWeeklyOff(onLeave).effectiveStatus());
    }

    /** A day's effective status; {@code reviewed}: set by a reviewer (the policy said weekly off). */
    private static EffectiveDay effective(Employee e, String status, Instant in, boolean reviewed) {
        return new EffectiveDay(e.getId(), SUNDAY, status, reviewed ? EffectiveDay.WEEKLY_OFF : status, in, null, "OFFICE",
                null, null, false, null, false, null, null, null, false, null, reviewed, reviewed ? "SET" : null,
                null, reviewed ? "HR" : null, null, false, false, null, null, null, null, null, null);
    }

    private Jwt admin() {
        return token(List.of("attendance.team.read", "attendance.workforce.admin"));
    }

    private Jwt manager() {
        return token(List.of("attendance.team.read"));
    }

    private Jwt token(List<String> permissions) {
        return Jwt.withTokenValue("t").header("alg", "none")
                .subject(me.getId().toString())
                .claim("employee_id", me.getId().toString())
                .claim("permissions", permissions)
                .build();
    }

    private static List<String> names(TeamDashboardResponse day) {
        return day.staffStatuses().stream().map(StaffStatusResponse::fullName).toList();
    }

    private static StaffStatusResponse row(TeamDashboardResponse day, Employee e) {
        return day.staffStatuses().stream().filter(s -> s.employeeId().equals(e.getId())).findFirst().orElseThrow();
    }

    private static Employee person(String first, String last) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(first);
        e.setLastName(last);
        e.setEmployeeCode(first.substring(0, 1) + "001");
        e.setCompanyId(COMPANY);
        return e;
    }
}
