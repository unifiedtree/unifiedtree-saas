package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.audit.AuditService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Redesign BW-78/79/81/84: cycle dates and the hold rule, counts in the caller's
 * scope, stages, ratings, per-review due dates. Every statement filters tenant_id.
 */
class PerformanceCycleServiceTest {

    private final UUID tenant = UUID.randomUUID(), cycle = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AuditService audit = mock(AuditService.class);
    private final PerformanceCycleService service = new PerformanceCycleService(jdbc, audit);

    private static LocalDate d(String iso) { return LocalDate.parse(iso); }

    private void milestonesTable(boolean exists) {
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class), any(Object[].class))).thenReturn(exists);
    }

    /** The cycle lookup finds {@code found}. */
    private void cycleExists(boolean found) throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.next()).thenReturn(found);
        when(rs.getString("name")).thenReturn("Q3 check-in");
        when(rs.getString("status")).thenReturn("ACTIVE");
        when(jdbc.query(contains("FROM performance_mgmt.review_cycles"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs));
    }

    // ── dates and the hold ───────────────────────────────────────────────────

    @Test void datesMustRunInStepOrder() {
        PerformanceCycleService.validateOrder(new PerformanceCycleService.MilestonesRequest(
                d("2026-07-10"), d("2026-09-20"), d("2026-09-30"), d("2026-10-12"), true));
        PerformanceCycleService.validateOrder(new PerformanceCycleService.MilestonesRequest(null, null, null, null, null));
        // A gap in the middle compares with the last date that is set.
        PerformanceCycleService.validateOrder(new PerformanceCycleService.MilestonesRequest(
                d("2026-07-10"), null, d("2026-09-30"), null, false));
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> PerformanceCycleService.validateOrder(
                new PerformanceCycleService.MilestonesRequest(d("2026-07-10"), d("2026-09-30"), d("2026-09-20"), null, false)));
        assertEquals("REVIEW_CYCLE_DATES_ORDER", e.getErrorCode());
        assertTrue(e.getMessage().startsWith("Manager reviews by can't be before self-reviews by"), e.getMessage());
    }

    @Test void heldFeedbackHidesOnlySubmittedReviewsOthersWroteAboutMe() {
        UUID me = UUID.randomUUID(), manager = UUID.randomUUID(), colleague = UUID.randomUUID();
        assertTrue(PerformanceCycleService.hiddenFrom(me, me, manager, "SUBMITTED", true));
        assertTrue(PerformanceCycleService.hiddenFrom(me, me, manager, "ACKNOWLEDGED", true));
        assertFalse(PerformanceCycleService.hiddenFrom(me, me, manager, "SUBMITTED", false), "no hold: shown");
        assertFalse(PerformanceCycleService.hiddenFrom(me, me, manager, "PENDING", true), "nothing written yet");
        assertFalse(PerformanceCycleService.hiddenFrom(me, me, me, "SUBMITTED", true), "my own self-review");
        assertFalse(PerformanceCycleService.hiddenFrom(me, me, null, "SUBMITTED", true), "self review with no reviewer set");
        assertFalse(PerformanceCycleService.hiddenFrom(me, colleague, me, "SUBMITTED", true), "a review I wrote about someone");
    }

    @Test void aCycleIsHeldUntilShared() {
        assertTrue(PerformanceCycleService.isHeld(new PerformanceCycleService.Milestones(null, null, null, null, true, null)));
        assertFalse(PerformanceCycleService.isHeld(new PerformanceCycleService.Milestones(null, null, null, null, true, "2026-10-12T05:00:00Z")));
        assertFalse(PerformanceCycleService.isHeld(PerformanceCycleService.Milestones.NONE));
        assertFalse(PerformanceCycleService.isHeld(null));
    }

    @Test void nothingIsHeldBeforeTheMigration() {
        milestonesTable(false);
        assertEquals(Set.of(), service.heldCycles(tenant, List.of(cycle)));
        verify(jdbc, never()).query(contains("review_cycle_milestones WHERE"), any(RowCallbackHandler.class), any(Object[].class));
    }

    @Test void savingDatesWithoutTheTableIsNotReadyAndWritesNothing() throws Exception {
        cycleExists(true);
        milestonesTable(false);
        assertThrows(FeatureNotReady.class, () -> service.saveMilestones(tenant, cycle,
                new PerformanceCycleService.MilestonesRequest(null, d("2026-09-20"), null, null, true), UUID.randomUUID()));
        assertThrows(FeatureNotReady.class, () -> service.share(tenant, cycle, UUID.randomUUID()));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void aCycleOfAnotherTenantIsNotFound() throws Exception {
        cycleExists(false);
        assertThrows(ResourceNotFoundException.class, () -> service.share(tenant, cycle, UUID.randomUUID()));
        verify(jdbc).query(contains("WHERE tenant_id = ? AND id = ?"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), eq(tenant), eq(cycle));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void savingDatesUpsertsForThisTenantAndAudits() throws Exception {
        cycleExists(true);
        milestonesTable(true);
        UUID actor = UUID.randomUUID();
        service.saveMilestones(tenant, cycle, new PerformanceCycleService.MilestonesRequest(
                d("2026-07-31"), d("2026-09-20"), d("2026-09-30"), d("2026-10-12"), true), actor);
        verify(jdbc).update(contains("ON CONFLICT (tenant_id, cycle_id)"), eq(tenant), eq(cycle),
                eq(java.sql.Date.valueOf("2026-07-31")), eq(java.sql.Date.valueOf("2026-09-20")),
                eq(java.sql.Date.valueOf("2026-09-30")), eq(java.sql.Date.valueOf("2026-10-12")), eq(true), eq(actor));
        verify(audit).record(eq("performance"), eq("REVIEW_CYCLE_DATES_SET"), eq("review_cycle"), eq(cycle), contains("held until shared"));
    }

    // ── counts in the caller's scope ─────────────────────────────────────────

    @SuppressWarnings("unchecked")
    @Test void countsCoverTheCompanyForHrAndOnlyTheTeamForAManager() {
        service.summary(tenant, null);
        verify(jdbc).query(argThat((String sql) -> sql.contains("WHERE r.tenant_id = ?") && sql.contains("c.tenant_id = r.tenant_id")
                && !sql.contains("r.employee_id IN")), any(RowMapper.class), eq(tenant));
        UUID a = UUID.randomUUID();
        service.summary(tenant, Set.of(a));
        verify(jdbc).query(contains("AND r.employee_id IN (?)"), any(RowMapper.class), eq(tenant), eq(a));
        service.summary(tenant, Set.of());
        verify(jdbc).query(contains("AND FALSE"), any(RowMapper.class), eq(tenant));
    }

    @Test void stagesAreOneGroupedQueryInScope() throws Exception {
        cycleExists(true);
        milestonesTable(false);
        UUID a = UUID.randomUUID();
        PerformanceCycleService.CycleStages stages = service.stages(tenant, cycle, Set.of(a));
        verify(jdbc).query(argThat((String sql) -> sql.contains("GROUP BY ROLLUP (r.reviewer_type)")
                        && sql.contains("r.tenant_id = ? AND r.cycle_id = ?") && sql.contains("r.employee_id IN (?)")),
                any(RowCallbackHandler.class), eq(tenant), eq(cycle), eq(a));
        assertNull(stages.milestones(), "no dates before the migration");
        assertEquals("Q3 check-in", stages.name());
    }

    @Test void ratingsCountManagerReviewsInScope() throws Exception {
        cycleExists(true);
        UUID a = UUID.randomUUID();
        service.ratings(tenant, cycle, Set.of(a));
        verify(jdbc).query(argThat((String sql) -> sql.contains("r.reviewer_type = 'MANAGER'")
                        && sql.contains("r.status IN ('SUBMITTED','ACKNOWLEDGED')") && sql.contains("r.employee_id IN (?)")),
                any(RowCallbackHandler.class), eq(tenant), eq(cycle), eq(a));
    }

    @Test void ratingBucketsRunFiveDownToOneWithTheAverage() {
        PerformanceCycleService.CycleRatings r = PerformanceCycleService.buckets(cycle, Map.of(5, 2, 3, 1), new BigDecimal("13.6"));
        assertEquals(3, r.total());
        assertEquals(List.of(5, 4, 3, 2, 1), r.buckets().stream().map(PerformanceCycleService.RatingBucket::rating).toList());
        assertEquals(List.of(2, 0, 1, 0, 0), r.buckets().stream().map(PerformanceCycleService.RatingBucket::count).toList());
        assertEquals(new BigDecimal("4.5"), r.average());
        assertNull(PerformanceCycleService.buckets(cycle, Map.of(), BigDecimal.ZERO).average());
    }

    // ── per-review facts and filters ─────────────────────────────────────────

    @Test void aSelfReviewIsDueByTheSelfReviewDateOthersByTheManagerDate() {
        LocalDate self = d("2026-09-20"), mgr = d("2026-09-30");
        assertEquals(self, PerformanceCycleService.dueDate("SELF", self, mgr));
        assertEquals(mgr, PerformanceCycleService.dueDate("MANAGER", self, mgr));
        assertEquals(mgr, PerformanceCycleService.dueDate("PEER", self, mgr));
        assertNull(PerformanceCycleService.dueDate("SELF", null, mgr));
    }

    @Test void statusFilterNamesMapToReviewStatuses() {
        assertNull(PerformanceCycleService.statusesFor(null));
        assertNull(PerformanceCycleService.statusesFor(" "));
        assertEquals(List.of("PENDING", "IN_PROGRESS"), PerformanceCycleService.statusesFor("waiting"));
        assertEquals(List.of("SUBMITTED", "ACKNOWLEDGED"), PerformanceCycleService.statusesFor("SUBMITTED"));
        assertEquals(List.of("MISSED"), PerformanceCycleService.statusesFor("missed"));
        assertEquals("INVALID_STATUS", assertThrows(BusinessRuleException.class,
                () -> PerformanceCycleService.statusesFor("DONE")).getErrorCode());
    }

    @Test void extrasReadOnlyThisTenantsReviews() {
        milestonesTable(true);
        UUID review = UUID.randomUUID();
        service.extras(tenant, List.of(review));
        verify(jdbc).query(argThat((String sql) -> sql.contains("WHERE r.tenant_id = ? AND r.id IN (?)")
                        && sql.contains("d.tenant_id = e.tenant_id") && sql.contains("m.tenant_id = r.tenant_id")),
                any(RowCallbackHandler.class), eq(tenant), eq(review));
    }

    @Test void myCurrentCycleNeedsAnEmployeeRecord() {
        assertEquals(List.of(), service.myCurrent(tenant, null));
        verifyNoInteractions(jdbc);
    }
}
