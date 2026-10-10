package com.hrms.attendance.service;

import com.hrms.attendance.service.EffectiveShiftResolver.EffectiveShift;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** The parts of {@link EffectiveShiftResolver} that need no database; the lookups are pinned by the characterization tests. */
class EffectiveShiftResolverTest {

    private static final UUID EMP = UUID.randomUUID();
    private static final LocalDate DAY = LocalDate.of(2026, 8, 5);

    private static EffectiveShift shift(String name, String type, LocalDate from, LocalDate to, LocalTime core) {
        return new EffectiveShift(EMP, null, from, to, UUID.randomUUID(), null, null, name, type,
                LocalTime.of(9, 0), LocalTime.of(18, 0), 10, 8.0, core, null);
    }

    @Test void theLatestStartCoveringTheDayIsInForce() {
        EffectiveShift old = shift("Old", "FIXED", DAY.minusDays(30), null, null);
        EffectiveShift newer = shift("Newer", "FIXED", DAY.minusDays(2), null, null);
        EffectiveShift future = shift("Future", "FIXED", DAY.plusDays(1), null, null);
        EffectiveShift ended = shift("Ended", "FIXED", DAY.minusDays(1), DAY.minusDays(1), null);
        assertEquals("Newer", EffectiveShiftResolver.inForceOn(List.of(future, ended, old, newer), DAY).name());
        assertEquals("Old", EffectiveShiftResolver.inForceOn(List.of(future, ended, old), DAY).name());
        assertEquals("Ended", EffectiveShiftResolver.inForceOn(List.of(old, ended), DAY.minusDays(1)).name(), "the last day counts");
        assertNull(EffectiveShiftResolver.inForceOn(List.of(future), DAY));
        assertNull(EffectiveShiftResolver.inForceOn(List.of(), DAY));
        assertNull(EffectiveShiftResolver.inForceOn(null, DAY));
        assertNull(EffectiveShiftResolver.inForceOn(List.of(old), null));
        // Two from the same day: the first one given.
        EffectiveShift twin = shift("Twin", "FIXED", DAY.minusDays(2), null, null);
        assertEquals("Newer", EffectiveShiftResolver.inForceOn(List.of(newer, twin), DAY).name());
    }

    @Test void aFlexibleShiftWithCoreHoursIsLateFromCoreStartWithNoGrace() {
        EffectiveShift flex = shift("Flex", "FLEXIBLE", DAY, null, LocalTime.of(10, 0));
        assertTrue(flex.lateFromCoreStart());
        assertEquals(LocalTime.of(10, 0), flex.lateFrom());
        assertEquals(0, flex.lateGraceMinutes());
        EffectiveShift flexNoCore = shift("Flex", "FLEXIBLE", DAY, null, null);
        assertEquals(LocalTime.of(9, 0), flexNoCore.lateFrom());
        assertEquals(10, flexNoCore.lateGraceMinutes());
        EffectiveShift fixedWithCore = shift("Fixed", "FIXED", DAY, null, LocalTime.of(10, 0));
        assertEquals(LocalTime.of(9, 0), fixedWithCore.lateFrom(), "core hours only matter on a flexible shift");
        assertEquals(10, fixedWithCore.lateGraceMinutes());
    }

    @Test void theScheduleRuleBreaksTiesByCreationAndKeepsAnyShift() {
        String sql = EffectiveShiftResolver.scheduleAssignment("e.tenant_id", "e.id", ":today");
        assertTrue(sql.contains("a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.effective_from <= :today"));
        assertTrue(sql.contains("(a.effective_to IS NULL OR a.effective_to >= :today)"));
        assertTrue(sql.endsWith("ORDER BY a.effective_from DESC, a.created_at DESC LIMIT 1"));
        assertFalse(sql.contains("is_active"), "an archived shift still counts");
        assertEquals("LEFT JOIN attendance.shift_policies s ON s.id = sa.shift_policy_id AND s.tenant_id = r.tenant_id",
                EffectiveShiftResolver.scheduleShiftJoin("sa", "r.tenant_id"));
    }

    @Test void noPeopleNoQuery() {
        JdbcTemplate failing = mock(JdbcTemplate.class, inv -> {
            throw new DataAccessResourceFailureException("database down");
        });
        assertEquals(Map.of(), EffectiveShiftResolver.attendanceShifts(failing, List.of(), DAY, DAY));
        assertEquals(Map.of(), EffectiveShiftResolver.attendanceShifts(failing, List.of(EMP), null, DAY));
        assertEquals(List.of(), EffectiveShiftResolver.dashboardShifts(failing, List.of(), DAY));
        assertEquals(Map.of(), EffectiveShiftResolver.peopleOnEachShift(failing, UUID.randomUUID(), List.of(), DAY));
        assertEquals(Map.of(), EffectiveShiftResolver.shiftsOn(failing, List.of(), DAY));
        // The attendance weekly-off rule is AttendanceCalendar's: without a database, Saturday and Sunday.
        assertEquals(Map.of(EMP, java.util.Set.of(6, 7)), EffectiveShiftResolver.attendanceWeeklyOffDays(null, List.of(EMP), DAY));
        // With people, the database is asked and its failure is the caller's.
        assertThrows(DataAccessResourceFailureException.class, () -> EffectiveShiftResolver.attendanceShift(failing, EMP, DAY));
        assertThrows(DataAccessResourceFailureException.class, () -> EffectiveShiftResolver.attendanceShifts(failing, List.of(EMP), DAY, DAY));
    }
}
