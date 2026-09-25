package com.hrms.api.performance;

import com.hrms.performance.service.GoalService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Who may see a reviewee's goals, which goals belong to a cycle, and My goals history rules. */
class PerformanceInsightServiceTest {
    private final UUID tenant = UUID.randomUUID();
    private final UUID reviewee = UUID.randomUUID(), reviewer = UUID.randomUUID(), cycle = UUID.randomUUID();
    private final UUID reviewId = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PerformanceTeamScope teamScope = mock(PerformanceTeamScope.class);
    private final PerformanceInsightService service =
            new PerformanceInsightService(jdbc, teamScope, mock(KpiService.class), mock(GoalService.class));

    @AfterEach void clear() {
        SecurityContextHolder.clearContext();
        com.hrms.core.tenant.TenantContext.clear();
        com.unifiedtree.security.tenant.TenantContext.clear();
    }

    private void signIn(UUID employeeId, String role, String... permissions) {
        var jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("roles", List.of(role)).claim("employee_id", employeeId.toString()).build();
        List<SimpleGrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
        for (String p : permissions) authorities.add(new SimpleGrantedAuthority(p));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, authorities));
    }

    /** The review lookup returns one review about {@code reviewee}, written by {@code reviewer}. */
    private void reviewExists() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.next()).thenReturn(true);
        when(rs.getObject("employee_id", UUID.class)).thenReturn(reviewee);
        when(rs.getObject("reviewer_id", UUID.class)).thenReturn(reviewer);
        when(rs.getObject("cycle_id", UUID.class)).thenReturn(cycle);
        when(rs.getString("cycle_name")).thenReturn("H1 2026");
        when(rs.getString("employee_name")).thenReturn("Reader User");
        when(jdbc.query(contains("FROM performance_mgmt.performance_reviews"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs));
    }

    @Test void participantsAreTheReviewerAndTheReviewee() {
        assertTrue(PerformanceInsightService.mayReadAsParticipant(reviewer, reviewee, reviewer));
        assertTrue(PerformanceInsightService.mayReadAsParticipant(reviewee, reviewee, reviewer));
        assertTrue(PerformanceInsightService.mayReadAsParticipant(reviewee, reviewee, null), "self review");
        assertFalse(PerformanceInsightService.mayReadAsParticipant(UUID.randomUUID(), reviewee, reviewer));
        assertFalse(PerformanceInsightService.mayReadAsParticipant(null, reviewee, reviewer));
    }

    @Test void cycleWindowKeepsGoalsOfThatCycleOrLiveDuringIt() {
        StringBuilder sql = new StringBuilder("WHERE 1=1");
        List<Object> args = new ArrayList<>();
        PerformanceInsightService.appendCycleWindow(sql, args, cycle, "2026-04-01", "2026-09-30");
        String s = sql.toString();
        assertTrue(s.contains("g.cycle_id = ? OR (g.cycle_id IS NULL"), s);
        assertTrue(s.contains("g.due_date IS NULL OR g.due_date >= ?"), s);
        assertTrue(s.contains("AT TIME ZONE 'Asia/Kolkata'"), "India dates, not UTC: " + s);
        assertEquals(List.of(cycle, java.sql.Date.valueOf("2026-04-01"), java.sql.Date.valueOf("2026-09-30")), args);
    }

    @Test void cycleWindowWithoutPeriodKeepsEveryUntiedGoal() {
        StringBuilder sql = new StringBuilder();
        List<Object> args = new ArrayList<>();
        PerformanceInsightService.appendCycleWindow(sql, args, null, null, null);
        assertEquals(" AND ((g.cycle_id IS NULL))", sql.toString());
        assertTrue(args.isEmpty());
    }

    @Test void aColleagueWhoIsNotTheReviewerCannotReadTheGoals() throws Exception {
        reviewExists();
        signIn(UUID.randomUUID(), "EMPLOYEE", "hrms.performance.review.self");
        assertThrows(AccessDeniedException.class, () -> service.reviewGoals(tenant, reviewId));
        verify(jdbc, never()).query(contains("FROM performance_mgmt.goals"), any(RowMapper.class), any(Object[].class));
        verifyNoInteractions(teamScope);
    }

    @Test void theAssignedReviewerReadsTheRevieweesGoalsForTheCycle() throws Exception {
        reviewExists();
        signIn(reviewer, "EMPLOYEE", "hrms.performance.review.self");
        var result = service.reviewGoals(tenant, reviewId);
        assertEquals(reviewee, result.employeeId());
        assertEquals("H1 2026", result.cycleName());
        verify(jdbc).query(contains("g.employee_id = ?"), any(RowMapper.class), eq(tenant), eq(reviewee), eq(cycle));
    }

    @Test void aManagerSeesTeamReviewsOnlyAndHrSeesAll() throws Exception {
        reviewExists();
        signIn(UUID.randomUUID(), "DEPT_MANAGER", "hrms.performance.read", "hrms.performance.review.self");
        when(teamScope.visibleEmployeeIds()).thenReturn(Set.of(UUID.randomUUID()));
        assertThrows(AccessDeniedException.class, () -> service.reviewGoals(tenant, reviewId));
        when(teamScope.visibleEmployeeIds()).thenReturn(Set.of(reviewee));
        assertEquals(reviewee, service.reviewGoals(tenant, reviewId).employeeId());
        signIn(UUID.randomUUID(), "HR_MANAGER", "hrms.performance.read");
        when(teamScope.visibleEmployeeIds()).thenReturn(null);
        assertEquals(reviewee, service.reviewGoals(tenant, reviewId).employeeId());
    }

    @Test void historyOfSomeoneElsesGoalIsRefused() throws Exception {
        UUID goal = UUID.randomUUID(), me = UUID.randomUUID();
        ResultSet rs = mock(ResultSet.class);
        when(rs.next()).thenReturn(true);
        when(rs.getObject(1, UUID.class)).thenReturn(UUID.randomUUID());
        when(jdbc.query(contains("SELECT employee_id FROM performance_mgmt.goals"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs));
        assertThrows(AccessDeniedException.class, () -> service.myGoalHistory(tenant, goal, me));
        assertThrows(AccessDeniedException.class, () -> service.myGoalHistory(tenant, goal, null));
    }

    @Test void aProgressUpdateIsRecordedWhenTheValueChangesOrANoteIsLeft() {
        assertTrue(PerformanceInsightService.shouldRecord(null, 10, null));
        assertTrue(PerformanceInsightService.shouldRecord(10, 40, null));
        assertTrue(PerformanceInsightService.shouldRecord(40, 40, "Blocked on design review"));
        assertFalse(PerformanceInsightService.shouldRecord(40, 40, null));
        assertNull(PerformanceInsightService.cleanNote("   "));
        assertEquals("Done", PerformanceInsightService.cleanNote("  Done "));
        assertEquals(PerformanceInsightService.MAX_NOTE, PerformanceInsightService.cleanNote("x".repeat(1500)).length());
    }

    @Test void activeFilterCountsOnlyGoalsStillBeingWorkedOn() {
        JdbcTemplate kpiJdbc = mock(JdbcTemplate.class);
        signIn(UUID.randomUUID(), "HR_MANAGER", "hrms.performance.read");
        new KpiService(kpiJdbc, teamScope).list(tenant, reviewee, null, null, null, true, 0, 25);
        verify(kpiJdbc).queryForObject(contains("g.status IN ('ACTIVE','AT_RISK')"), eq(Long.class), eq(tenant), eq(reviewee));
        assertEquals(Set.of("ACTIVE", "AT_RISK"), KpiService.ACTIVE_STATUSES);
    }
}
