package com.hrms.api.attendance;

import com.hrms.api.attendance.AttendanceInsightsController.Breakdown;
import com.hrms.api.attendance.AttendanceInsightsController.Data;
import com.hrms.api.attendance.AttendanceInsightsController.Punctuality;
import com.hrms.api.attendance.AttendanceInsightsController.Stats;
import com.hrms.attendance.policy.EffectiveDay;
import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-20 analytics breakdown and BW-21 punctuality: the numbers from effective
 * day statuses, the comparison period, and the team scope.
 */
class AttendanceInsightsTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    // 3–7 August 2026 is Monday to Friday; the 8th and 9th are the weekend.
    private static final LocalDate MON = LocalDate.of(2026, 8, 3);

    private static Instant at(LocalDate d, int h, int m) {
        return d.atTime(LocalTime.of(h, m)).atZone(IST).toInstant();
    }

    /** An effective day: status, check-in, late minutes, and the shift's start (null = no shift). */
    private static EffectiveDay day(UUID id, LocalDate d, String status, Instant in, Integer late, Instant shiftStart) {
        return new EffectiveDay(id, d, status, status, in, null, "OFFICE", late, null, false, null, false, null, null,
                null, false, null, false, null, null, null, null, false, false, null,
                shiftStart == null ? null : "General", shiftStart, null, 10, null);
    }

    private static Employee person(String first, UUID department, UUID branch) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(first);
        e.setLastName("Test");
        e.setEmployeeCode("E-" + first);
        e.setDepartmentId(department);
        e.setBranchId(branch);
        e.setCompanyId(UUID.randomUUID());
        return e;
    }

    // ── the comparison period ────────────────────────────────────────────────

    @Test void theMonthSoFarComparesWithTheSameDaysOfTheMonthBefore() {
        assertArrayEquals(new LocalDate[]{LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 27)},
                AttendanceInsightsController.previousPeriod(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 27)));
        // A whole month compares with the whole month before, whatever its length.
        assertArrayEquals(new LocalDate[]{LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31)},
                AttendanceInsightsController.previousPeriod(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30)));
        assertArrayEquals(new LocalDate[]{LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28)},
                AttendanceInsightsController.previousPeriod(LocalDate.of(2026, 3, 1), LocalDate.of(2026, 3, 30)));
        assertArrayEquals(new LocalDate[]{LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28)},
                AttendanceInsightsController.previousPeriod(LocalDate.of(2026, 3, 1), LocalDate.of(2026, 3, 31)));
        // Any other period: the same number of days just before it.
        assertArrayEquals(new LocalDate[]{LocalDate.of(2026, 9, 3), LocalDate.of(2026, 9, 9)},
                AttendanceInsightsController.previousPeriod(LocalDate.of(2026, 9, 10), LocalDate.of(2026, 9, 16)));
    }

    @Test void theRangeIsOneTo62Days() {
        AttendanceInsightsController.requireRange(MON, MON, "X");
        AttendanceInsightsController.requireRange(MON, MON.plusDays(61), "X");
        assertEquals("X", assertThrows(BusinessRuleException.class,
                () -> AttendanceInsightsController.requireRange(MON, MON.plusDays(62), "X")).getErrorCode());
        assertThrows(BusinessRuleException.class, () -> AttendanceInsightsController.requireRange(MON, MON.minusDays(1), "X"));
    }

    // ── the numbers ──────────────────────────────────────────────────────────

    @Test void rateAbsenceAndArrivalComeFromWorkingDaysOnly() {
        UUID a = UUID.randomUUID();
        Map<LocalDate, EffectiveDay> days = new HashMap<>();
        days.put(MON, day(a, MON, EffectiveDay.PRESENT, at(MON, 8, 55), null, at(MON, 9, 0)));                          // 5 min early
        days.put(MON.plusDays(1), day(a, MON.plusDays(1), EffectiveDay.LATE, at(MON.plusDays(1), 9, 25), 25, at(MON.plusDays(1), 9, 0)));
        days.put(MON.plusDays(2), day(a, MON.plusDays(2), EffectiveDay.ON_LEAVE, null, null, null));
        days.put(MON.plusDays(3), day(a, MON.plusDays(3), EffectiveDay.ABSENT, null, null, null));
        days.put(MON.plusDays(4), day(a, MON.plusDays(4), EffectiveDay.HALF_DAY, at(MON.plusDays(4), 9, 10), null, null)); // no shift: no arrival
        // Worked on the weekend: a weekly off, so it counts nowhere.
        days.put(MON.plusDays(5), day(a, MON.plusDays(5), EffectiveDay.PRESENT, at(MON.plusDays(5), 11, 0), null, at(MON.plusDays(5), 9, 0)));
        Data data = new Data(Map.of(a, days), Map.of(a, Set.of(6, 7)), Map.of(a, Set.of()));

        Stats s = AttendanceInsightsController.stats(List.of(a), MON, MON.plusDays(6), data);

        assertEquals(5, s.workingDays());
        assertEquals(3, s.attendedDays());
        assertEquals(1, s.lateDays());
        assertEquals(1, s.leaveDays());
        assertEquals(1, s.absentDays());
        assertEquals(0, s.notMarkedDays());
        assertEquals(75.0, s.ratePct(), "3 of 4 expected: leave is left out");
        assertEquals(20.0, s.unplannedAbsencePct(), "1 of 5 working days");
        assertEquals(2, s.arrivals());
        assertEquals(10.0, s.avgArrivalMinutes(), "(-5 + 25) / 2");
        assertEquals("09:10", s.avgArrivalTime());
    }

    @Test void aHolidayIsNotAWorkingDayAndNothingToCountGivesNulls() {
        UUID a = UUID.randomUUID();
        Map<LocalDate, EffectiveDay> days = Map.of(MON, day(a, MON, EffectiveDay.ABSENT, null, null, null));
        Stats s = AttendanceInsightsController.stats(List.of(a), MON, MON,
                new Data(Map.of(a, days), Map.of(a, Set.of(6, 7)), Map.of(a, Set.of(MON))));
        assertEquals(0, s.workingDays());
        assertNull(s.ratePct());
        assertNull(s.unplannedAbsencePct());
        assertNull(s.avgArrivalMinutes());
        assertNull(s.avgArrivalTime());
    }

    @Test void aNightShiftArrivalAcrossMidnightIsFolded() {
        UUID a = UUID.randomUUID();
        // Shift at 22:00 on the 3rd; checked in 00:10 on the 4th = 130 minutes late, not -1310.
        EffectiveDay d = day(a, MON, EffectiveDay.LATE, at(MON.plusDays(1), 0, 10), 130, at(MON, 22, 0));
        assertEquals(130, AttendanceInsightsController.arrivalMinutes(d));
        EffectiveDay early = day(a, MON, EffectiveDay.PRESENT, at(MON, 21, 50), null, at(MON, 22, 0));
        assertEquals(-10, AttendanceInsightsController.arrivalMinutes(early));
        // The mean clock time wraps midnight too.
        assertEquals("00:00", AttendanceInsightsController.clock(0.0));
    }

    @Test void punctualityCountsLateDaysDelayWorstWeekdayAndTheMonthBefore() {
        UUID dept = UUID.randomUUID();
        Employee often = person("Rahul", dept, null), once = person("Asha", dept, null), never = person("Vikram", null, null);
        Map<UUID, Map<LocalDate, EffectiveDay>> days = new HashMap<>();
        Map<LocalDate, EffectiveDay> r = new HashMap<>();
        LocalDate mon2 = MON.plusDays(7), wed = MON.plusDays(2);
        r.put(MON, day(often.getId(), MON, EffectiveDay.LATE, at(MON, 9, 30), 30, at(MON, 9, 0)));
        r.put(mon2, day(often.getId(), mon2, EffectiveDay.LATE, at(mon2, 9, 20), 20, at(mon2, 9, 0)));
        r.put(wed, day(often.getId(), wed, EffectiveDay.LATE, at(wed, 9, 40), 40, at(wed, 9, 0)));
        // Within the late allowance: PRESENT, so not a late mark.
        r.put(MON.plusDays(3), day(often.getId(), MON.plusDays(3), EffectiveDay.PRESENT, at(MON.plusDays(3), 9, 15), 15, at(MON.plusDays(3), 9, 0)));
        // The previous period (July).
        LocalDate july = LocalDate.of(2026, 7, 6);
        r.put(july, day(often.getId(), july, EffectiveDay.LATE, at(july, 9, 30), 30, at(july, 9, 0)));
        days.put(often.getId(), r);
        days.put(once.getId(), Map.of(wed, day(once.getId(), wed, EffectiveDay.LATE, at(wed, 9, 12), null, at(wed, 9, 0))));
        Data data = new Data(days, Map.of(), Map.of());
        LocalDate[] prev = {LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31)};

        Punctuality p = AttendanceInsightsController.punctuality(List.of(never, once, often), Map.of(dept, "Sales"),
                LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31), prev, data);

        assertEquals(2, p.rows().size(), "only people late at least once");
        var first = p.rows().get(0);
        assertEquals(often.getId(), first.employeeId());
        assertEquals("Rahul Test", first.employeeName());
        assertEquals("Sales", first.departmentName());
        assertEquals(3, first.lateDays());
        assertEquals(30.0, first.avgDelayMinutes());
        assertEquals(1, first.worstWeekday(), "two Mondays");
        assertEquals(2, first.worstWeekdayLateDays());
        assertEquals(1, first.previousLateDays());
        var second = p.rows().get(1);
        assertEquals(1, second.lateDays());
        assertNull(second.avgDelayMinutes(), "a late mark set by hand has no minutes");
        assertEquals(3, second.worstWeekday());
        assertEquals(4, p.totals().lateDays());
        assertEquals(2, p.totals().people());
        assertEquals(30.0, p.totals().avgDelayMinutes());
        assertEquals(1, p.totals().previousLateDays());
    }

    // ── scope ────────────────────────────────────────────────────────────────

    @Test void aManagerSeesOnlyTheirTeam() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        EffectiveDayStatusService effective = mock(EffectiveDayStatusService.class);
        UUID dept = UUID.randomUUID();
        Employee report1 = person("Ravi", dept, null), report2 = person("Sita", dept, null);
        Jwt manager = Jwt.withTokenValue("t").header("alg", "none").subject("m").claim("employee_id", UUID.randomUUID().toString()).build();
        when(scope.resolve(eq(manager), isNull())).thenReturn(List.of(report1, report2));
        when(effective.effectiveStatuses(any(), any(), any())).thenReturn(Map.of(
                report1.getId(), Map.of(MON, day(report1.getId(), MON, EffectiveDay.LATE, at(MON, 9, 30), 30, at(MON, 9, 0)))));
        AttendanceInsightsController c = new AttendanceInsightsController(scope, effective, mock(JdbcTemplate.class));

        Punctuality p = c.punctuality(manager, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 27));
        Breakdown b = c.breakdown(manager, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 27), "department");

        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<Collection<UUID>> ids = org.mockito.ArgumentCaptor.forClass(Collection.class);
        verify(effective, times(2)).effectiveStatuses(ids.capture(), eq(LocalDate.of(2026, 7, 1)), eq(LocalDate.of(2026, 8, 27)));
        for (Collection<UUID> asked : ids.getAllValues()) {
            assertEquals(Set.of(report1.getId(), report2.getId()), Set.copyOf(asked), "only the team, from the scope");
        }
        assertEquals(List.of(report1.getId()), p.rows().stream().map(AttendanceInsightsController.PunctualityRow::employeeId).toList());
        assertEquals(2, b.people());
        assertEquals(1, b.groups().size());
        assertEquals(dept, b.groups().get(0).id());
        assertEquals(1, b.overall().lateDays());
        assertEquals(LocalDate.of(2026, 7, 1), b.previousFrom());
    }

    @Test void someoneWithNoEmployeeRecordGetsNothing() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        EffectiveDayStatusService effective = mock(EffectiveDayStatusService.class);
        when(scope.resolve(any(), isNull())).thenThrow(new IllegalArgumentException("Employee not found"));
        AttendanceInsightsController c = new AttendanceInsightsController(scope, effective, mock(JdbcTemplate.class));

        Punctuality p = c.punctuality(null, MON, MON.plusDays(4));
        Breakdown b = c.breakdown(null, MON, MON.plusDays(4), "branch");

        assertTrue(p.rows().isEmpty());
        assertEquals(0, b.people());
        assertTrue(b.groups().isEmpty());
        verifyNoInteractions(effective);
    }

    @Test void onlyDepartmentOrBranch() {
        AttendanceInsightsController c = new AttendanceInsightsController(mock(TeamEmployeeScope.class),
                mock(EffectiveDayStatusService.class), mock(JdbcTemplate.class));
        assertEquals("BREAKDOWN_GROUP_INVALID", assertThrows(BusinessRuleException.class,
                () -> c.breakdown(null, MON, MON, "manager")).getErrorCode());
    }

    @Test void bothNeedTheTeamReadPermission() throws Exception {
        for (String m : new String[]{"breakdown", "punctuality"}) {
            var method = java.util.Arrays.stream(AttendanceInsightsController.class.getMethods())
                    .filter(x -> x.getName().equals(m) && x.getParameterCount() >= 3 && x.getParameterTypes()[0] == Jwt.class)
                    .findFirst().orElseThrow();
            assertEquals("hasAuthority('attendance.team.read')", method.getAnnotation(PreAuthorize.class).value(), m);
        }
    }
}
