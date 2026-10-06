package com.hrms.api.workforce;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The admin dashboard's summary (GET /v1/admin/dashboard/stats): the Total employees tile's headcount and its
 * split, today as on a past day, by the one rule of {@link DashboardAsOf}. Today used to send only the confirmed
 * (ACTIVE) count, so the tile showed the day's attendance roster instead: 0 on a weekly off.
 */
class DashboardSummaryStatsTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final DashboardHistory history = mock(DashboardHistory.class);
    private final DashboardSummaryController controller =
            new DashboardSummaryController(jdbc, mock(NamedParameterJdbcTemplate.class), mock(TeamEmployeeScope.class), history);
    private final UUID tenant = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();
    /** 11 on the roll: 1 confirmed, 9 on probation, 1 serving notice; 2 joined and 1 left this month. */
    private final DashboardAsOf.Headcount roll = new DashboardAsOf.Headcount(11, 1, 9, 1, 2, 1);

    @BeforeEach void tenant() {
        TenantContext.setTenantId(tenant);
        when(history.headcount(eq(tenant), eq(company), any(LocalDate.class))).thenReturn(roll);
        when(history.headcount(eq(tenant), eq(company), any(LocalDate.class), eq(true))).thenReturn(roll);
    }
    @AfterEach void clear() { TenantContext.clear(); }

    private static Authentication holding(String... permissions) {
        return new TestingAuthenticationToken("user", "n/a", permissions);
    }

    @Test void todaySendsTheHeadcountAndItsSplit() {
        Map<String, Object> stats = controller.stats(company, null, holding("org.company.read", "hrms.employee.read"));

        verify(history).headcount(tenant, company, LocalDate.now(DashboardAsOf.IST));
        assertEquals(11L, stats.get("headcount"));
        assertEquals(1L, stats.get("activeEmployees"));
        assertEquals(9L, stats.get("probation"));
        assertEquals(1L, stats.get("onNotice"));
        // Today's view has no month-to-date joiners and leavers (the past view's note).
        assertFalse(stats.containsKey("joinedInMonth"));
        // The old confirmed-only count is gone: it disagreed with the headcount.
        verify(jdbc, never()).queryForObject(contains("employment_status='ACTIVE'"), eq(Long.class), any(), any());
    }

    @Test void todayOrALaterDateIsTodaysView() {
        controller.stats(company, LocalDate.now(DashboardAsOf.IST).plusDays(3), holding("org.company.read", "hrms.employee.read"));
        verify(history).headcount(tenant, company, LocalDate.now(DashboardAsOf.IST));
    }

    @Test void aPastDaySendsTheSameSplitAndThatMonthsJoinersAndLeavers() {
        LocalDate past = LocalDate.now(DashboardAsOf.IST).minusDays(10);
        Map<String, Object> stats = controller.stats(company, past, holding("org.company.read", "hrms.employee.read"));

        // A past day counts leavers on their last working day, as that day's attendance roster (6 Oct).
        verify(history).headcount(tenant, company, past, true);
        assertEquals(11L, stats.get("headcount"));
        assertEquals(1L, stats.get("activeEmployees"));
        assertEquals(9L, stats.get("probation"));
        assertEquals(1L, stats.get("onNotice"));
        assertEquals(2L, stats.get("joinedInMonth"));
        assertEquals(1L, stats.get("leftInMonth"));
    }

    @Test void withoutEmployeeReadThereAreNoPeopleFigures() {
        Map<String, Object> stats = controller.stats(company, null, holding("org.company.read"));

        verifyNoInteractions(history);
        for (String key : new String[] {"headcount", "activeEmployees", "probation", "onNotice"}) {
            assertFalse(stats.containsKey(key), key);
        }
        assertTrue(stats.containsKey("month"));
    }
}
