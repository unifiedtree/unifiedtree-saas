package com.hrms.api.attendance;

import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.util.LinkedCaseInsensitiveMap;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-22: each GET /v1/team/schedule row gains onLeave, weeklyOff and
 * holidayName; every existing field stays as it was, and the helper columns
 * the query uses never reach the response.
 */
class TeamScheduleDayFactsTest {

    /** A row as JdbcTemplate.queryForList returns it (case-insensitive keys, insertion order). */
    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedCaseInsensitiveMap<>();
        m.put("employeeId", UUID.randomUUID());
        m.put("employeeName", "Reader User");
        m.put("date", java.sql.Date.valueOf("2026-10-03"));
        m.put("shiftName", "General");
        m.put("startTime", java.sql.Time.valueOf("09:00:00"));
        m.put("endTime", java.sql.Time.valueOf("17:00:00"));
        m.put("shiftPolicyId", UUID.randomUUID());
        m.put("since", "2026-06-01");
        m.put("joinedOn", "2026-06-01");
        m.put("_leaveTypeName", null);
        m.put("_leaveDuration", null);
        m.put("_leaveHalfDay", false);
        m.put("_onLeave", false);
        m.put("holidayName", null);
        m.put("_ownOffs", null);
        m.put("_shiftOffs", null);
        m.put("_companyOffs", null);
        m.put("_isoDow", 6);
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test void theExistingFieldsStayAndOnlyTheThreeFactsAreAdded() {
        Map<String, Object> r = row();
        TeamScheduleController.dayFacts(r);
        assertEquals(List.of("employeeId", "employeeName", "date", "shiftName", "startTime", "endTime", "shiftPolicyId",
                "since", "joinedOn", "holidayName", "onLeave", "weeklyOff"), List.copyOf(r.keySet()));
    }

    @Test void approvedLeaveIsShownWithItsTypeAndHalfDay() {
        Map<String, Object> full = row("_onLeave", true, "_leaveTypeName", "Casual leave", "_leaveDuration", "FULL_DAY");
        TeamScheduleController.dayFacts(full);
        assertEquals(Map.of("leaveTypeName", "Casual leave", "duration", "FULL_DAY", "halfDay", false), full.get("onLeave"));

        Map<String, Object> half = row("_onLeave", true, "_leaveTypeName", "Sick leave", "_leaveDuration", "HALF_DAY_AFTERNOON");
        TeamScheduleController.dayFacts(half);
        assertEquals(true, ((Map<?, ?>) half.get("onLeave")).get("halfDay"));

        Map<String, Object> legacy = row("_onLeave", true, "_leaveTypeName", "Casual leave", "_leaveHalfDay", true);
        TeamScheduleController.dayFacts(legacy);
        assertEquals(true, ((Map<?, ?>) legacy.get("onLeave")).get("halfDay"), "an older half-day row");

        Map<String, Object> none = row();
        TeamScheduleController.dayFacts(none);
        assertTrue(none.containsKey("onLeave"));
        assertNull(none.get("onLeave"));
    }

    @Test void weeklyOffIsTheirOwnElseTheShiftsElseTheCompanysElseSaturdayAndSunday() {
        // Own days win.
        assertEquals(Set.of(5), TeamScheduleController.weeklyOffDays("5", "6,7", "7"));
        // No own days: the shift's.
        assertEquals(Set.of(1), TeamScheduleController.weeklyOffDays(null, "1", "7"));
        assertEquals(Set.of(1), TeamScheduleController.weeklyOffDays(" ", "1", "7"));
        // Neither: the company's.
        assertEquals(Set.of(7), TeamScheduleController.weeklyOffDays(null, null, "7"));
        // Nothing set anywhere: Saturday and Sunday.
        assertEquals(Set.of(6, 7), TeamScheduleController.weeklyOffDays(null, null, null));

        Map<String, Object> saturday = row("_isoDow", 6);
        TeamScheduleController.dayFacts(saturday);
        assertEquals(true, saturday.get("weeklyOff"));
        Map<String, Object> saturdayWorked = row("_isoDow", 6, "_ownOffs", "7");
        TeamScheduleController.dayFacts(saturdayWorked);
        assertEquals(false, saturdayWorked.get("weeklyOff"), "their own weekly off is only Sunday");
        Map<String, Object> monday = row("_isoDow", 1, "_shiftOffs", "1");
        TeamScheduleController.dayFacts(monday);
        assertEquals(true, monday.get("weeklyOff"), "the shift's weekly off");
    }

    @Test void theHolidayNameComesThrough() {
        Map<String, Object> r = row("holidayName", "Gandhi Jayanti");
        TeamScheduleController.dayFacts(r);
        assertEquals("Gandhi Jayanti", r.get("holidayName"));
    }

    @Test void theScheduleStillAsksForTheSameTeamAndRange() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        when(scope.resolve(any(), isNull())).thenReturn(List.of(e));
        when(jdbc.queryForList(anyString(), anyMap())).thenReturn(new java.util.ArrayList<>(List.of(row())));
        UUID tenant = UUID.randomUUID();
        TenantContext.setTenantId(tenant);
        try {
            List<Map<String, Object>> out = new TeamScheduleController(scope, jdbc).schedule(null, LocalDate.of(2026, 9, 28), LocalDate.of(2026, 10, 4));
            assertEquals(1, out.size());
            assertFalse(out.get(0).keySet().stream().anyMatch(k -> k.startsWith("_")), "no helper column leaks");
            verify(jdbc).queryForList(eq(TeamScheduleController.SQL), eq(Map.of("from", LocalDate.of(2026, 9, 28),
                    "to", LocalDate.of(2026, 10, 4), "tenant", tenant, "employees", List.of(e.getId()))));
        } finally {
            TenantContext.clear();
        }
        // Only APPROVED leave, only active holidays of the person's own company, one row per person per day.
        assertTrue(TeamScheduleController.SQL.contains("lr.status='APPROVED'"));
        assertTrue(TeamScheduleController.SQL.contains("h.company_id=e.company_id AND h.is_active"));
        assertTrue(TeamScheduleController.SQL.contains("LIMIT 1\n) lv ON true"));
    }
}
