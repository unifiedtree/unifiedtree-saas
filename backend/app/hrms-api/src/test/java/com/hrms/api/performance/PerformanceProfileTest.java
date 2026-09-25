package com.hrms.api.performance;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** The per-employee performance page: scope and the summary tiles. */
class PerformanceProfileTest {
    private final UUID tenant = UUID.randomUUID(), person = UUID.randomUUID();

    @AfterEach void clear() {
        com.hrms.core.tenant.TenantContext.clear();
        com.unifiedtree.security.tenant.TenantContext.clear();
    }

    @Test void aManagerCannotOpenSomeoneOutsideTheirTeam() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        KpiService kpis = mock(KpiService.class);
        var service = new PerformanceEmployeeService(jdbc, kpis);
        assertThrows(AccessDeniedException.class, () -> service.profile(tenant, person, Set.of(UUID.randomUUID())));
        assertThrows(AccessDeniedException.class, () -> service.profile(tenant, person, Set.of()));
        // Refused before any personal data is read.
        verify(jdbc, never()).query(anyString(), any(org.springframework.jdbc.core.ResultSetExtractor.class), any(Object[].class));
        verify(jdbc, never()).query(anyString(), any(org.springframework.jdbc.core.RowMapper.class), any(Object[].class));
        verifyNoInteractions(kpis);
    }

    @Test void scopeNullMeansTheWholeCompany() {
        assertTrue(PerformanceEmployeeService.inScope(person, null));
        assertTrue(PerformanceEmployeeService.inScope(person, Set.of(person)));
        assertFalse(PerformanceEmployeeService.inScope(person, Set.of()));
    }

    private static PerformanceEmployeeService.ProfileReviewDto review(String status, String rating) {
        return new PerformanceEmployeeService.ProfileReviewDto(UUID.randomUUID(), UUID.randomUUID(), "Cycle", null, null,
                null, null, "MANAGER", status, rating == null ? null : new BigDecimal(rating), null, null, null, null);
    }

    private static KpiService.KpiRowDto goal(String status) {
        return new KpiService.KpiRowDto(UUID.randomUUID(), null, null, null, "Goal", null, null, null, null, null,
                null, null, null, null, status, null, null);
    }

    private static PerformanceEmployeeService.RatingPointDto point(String avg) {
        return new PerformanceEmployeeService.RatingPointDto(UUID.randomUUID(), "Cycle", null, null, new BigDecimal(avg), 1, null);
    }

    @Test void summaryTilesUseSubmittedReviewsAndLiveGoals() {
        var summary = PerformanceEmployeeService.summarize(
                List.of(point("3.50"), point("4.25")),
                List.of(review("SUBMITTED", "4"), review("ACKNOWLEDGED", "3"), review("PENDING", null),
                        review("MISSED", null), review("IN_PROGRESS", "5")),
                List.of(goal("ACTIVE"), goal("AT_RISK"), goal("COMPLETED"), goal("DROPPED")));
        assertEquals(new BigDecimal("4.25"), summary.latestRating(), "latest cycle's average");
        assertEquals(new BigDecimal("3.50"), summary.averageRating(), "only submitted / acknowledged ratings count");
        assertEquals(2, summary.activeGoals(), "active + at risk");
        assertEquals(1, summary.atRiskGoals());
        assertEquals(1, summary.completedGoals());
        assertEquals(2, summary.reviewsSubmitted());
        assertEquals(2, summary.reviewsPending(), "pending + in progress");
    }

    @Test void noReviewsMeansNoRatingNotZero() {
        var summary = PerformanceEmployeeService.summarize(List.of(), List.of(), List.of());
        assertNull(summary.latestRating());
        assertNull(summary.averageRating());
        assertEquals(0, summary.activeGoals());
    }
}
