package com.hrms.api.hiring;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;

import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** BW-65 summary, BW-66 funnel, BW-68 my interviews: the counting, from rows the database would return. */
class HiringInsightsServiceTest {

    private final UUID tenant = UUID.randomUUID();

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test void quartersAreCalendarQuarters() {
        assertEquals(LocalDate.of(2026, 7, 1), HiringInsightsService.quarterStart(LocalDate.of(2026, 9, 27)));
        assertEquals(LocalDate.of(2026, 1, 1), HiringInsightsService.quarterStart(LocalDate.of(2026, 3, 31)));
        assertEquals(LocalDate.of(2026, 10, 1), HiringInsightsService.quarterStart(LocalDate.of(2026, 10, 1)));
    }

    // ── summary ─────────────────────────────────────────────────────────────

    @Test void summaryCountsEveryRequisitionAndPositionsOnOpenAndOnHoldRoles() {
        FakeJdbc db = new FakeJdbc()
                .on("GROUP BY r.status", List.of(
                        row("status", "OPEN", "n", 3L, "openings", 7L),
                        row("status", "ON_HOLD", "n", 1L, "openings", 2L),
                        row("status", "CLOSED", "n", 4L, "openings", 9L)))
                .on("c.created_at >= ?", 5L)
                .on("GROUP BY c.stage", List.of(row("stage", "APPLIED", "n", 4L), row("stage", "HIRED", "n", 1L)));
        var s = new HiringInsightsService(db.jdbc).summary(null, LocalDate.of(2026, 9, 27));
        assertEquals(new HiringInsightsService.Requisitions(3, 1, 4, 8), s.requisitions());
        assertEquals(9, s.positionsToFill(), "openings on open and on-hold roles, not closed ones");
        assertEquals(5, s.candidatesThisQuarter());
        assertEquals(LocalDate.of(2026, 7, 1), s.quarterStart());
        assertEquals(LocalDate.of(2026, 9, 30), s.quarterEnd());
        assertEquals(HiringInsightsService.ALL_STAGES, s.openRoleStages().stream().map(HiringInsightsService.StageCount::stage).toList(),
                "every stage is listed, zero when empty");
        assertEquals(4, s.openRoleStages().get(0).count());
        assertEquals(0, s.openRoleStages().get(1).count());
        assertTrue(db.callsContaining("GROUP BY c.stage").get(0).sql().contains("r.status = 'OPEN'"), "stages are for open roles only");
        db.calls.forEach(c -> assertEquals(tenant, c.args().isEmpty() ? tenant : c.args().get(0), "every query is tenant-scoped"));
    }

    @Test void summaryFiltersByCompanyWhenAsked() {
        UUID company = UUID.randomUUID();
        FakeJdbc db = new FakeJdbc().on("c.created_at >= ?", 0L);
        new HiringInsightsService(db.jdbc).summary(company, LocalDate.of(2026, 9, 27));
        db.calls.forEach(c -> {
            assertTrue(c.sql().contains("r.company_id = ?"), c.sql());
            assertEquals(company, c.args().get(1));
        });
    }

    // ── funnel ──────────────────────────────────────────────────────────────

    private FakeJdbc funnelDb(Instant trackedFrom, List<Map<String, Object>> furthest, long untracked, long hires, Double avgDays) {
        Map<String, Object> hire = new HashMap<>();
        hire.put("hires", hires);
        hire.put("avg_days", avgDays);
        return new FakeJdbc().tables(Map.of(JdbcCandidateStageLog.TABLE, true))
                .on("SELECT min(changed_at)", List.of(row("min", trackedFrom == null ? null : java.sql.Timestamp.from(trackedFrom))))
                .on("WITH cohort AS", furthest)
                .on("NOT EXISTS (SELECT 1 FROM hiring_mgmt.candidate_stage_events", untracked)
                .on("WITH hired AS", hire);
    }

    @Test void theFunnelCountsEveryStageACandidateGotPastAndConvertsBetweenNeighbours() {
        // 10 added: 4 stopped at Applied, 3 at Screening, 1 at Interview, 1 at Offer, 1 hired.
        List<Map<String, Object>> rows = new ArrayList<>();
        int[] furthest = {0, 0, 0, 0, 1, 1, 1, 2, 3, 4};
        for (int f : furthest) rows.add(row("candidate_id", UUID.randomUUID(), "furthest", f));
        Instant tracked = Instant.parse("2026-07-01T00:00:00Z");
        FakeJdbc db = funnelDb(tracked, rows, 2, 1, 12.345);
        var f = new HiringInsightsService(db.jdbc).funnel(null, LocalDate.of(2026, 7, 2), LocalDate.of(2026, 9, 30));
        assertEquals(List.of(10L, 6L, 3L, 2L, 1L), f.stages().stream().map(HiringInsightsService.Reached::reached).toList());
        assertEquals(0.6, f.conversions().get(0).rate());
        assertEquals(0.5, f.conversions().get(1).rate());
        assertEquals(0.6667, f.conversions().get(2).rate());
        assertEquals(0.5, f.conversions().get(3).rate());
        assertEquals(10, f.trackedCandidates());
        assertEquals(2, f.untrackedCandidates(), "added before the history existed: counted apart, never in the rates");
        assertEquals(12.3, f.timeToHire().averageDays());
        assertEquals(1, f.timeToHire().hires());
        assertTrue(f.exact());
        assertEquals(tracked, f.trackedFrom());
    }

    @Test void withNobodyTrackedEveryRateIsEmptySoThePageShowsADash() {
        FakeJdbc db = funnelDb(null, List.of(), 7, 0, null);
        var f = new HiringInsightsService(db.jdbc).funnel(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30));
        f.conversions().forEach(c -> assertNull(c.rate()));
        assertNull(f.timeToHire().averageDays());
        assertFalse(f.exact());
        assertNull(f.trackedFrom());
        assertEquals(7, f.untrackedCandidates());
    }

    @Test void aPeriodStartingBeforeTheHistoryIsNotExact() {
        FakeJdbc db = funnelDb(Instant.parse("2026-09-27T05:00:00Z"), List.of(), 0, 0, null);
        var f = new HiringInsightsService(db.jdbc).funnel(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30));
        assertFalse(f.exact());
    }

    @Test void theFunnelIsNotReadyWithoutTheHistoryTable() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        assertThrows(FeatureNotReady.class,
                () -> new HiringInsightsService(db.jdbc).funnel(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30)));
        assertTrue(db.callsContaining("candidate_stage_events").isEmpty());
    }

    @Test void aColumnMissingMidQueryIsAlsoNotReady() {
        FakeJdbc db = new FakeJdbc().tables(Map.of(JdbcCandidateStageLog.TABLE, true))
                .on("SELECT min(changed_at)", c -> { throw new BadSqlGrammarException("q", c.sql(), new SQLException("no column", "42703")); });
        assertThrows(FeatureNotReady.class,
                () -> new HiringInsightsService(db.jdbc).funnel(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30)));
    }

    @Test void anUpsideDownPeriodIsRefused() {
        FakeJdbc db = new FakeJdbc();
        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> new HiringInsightsService(db.jdbc).funnel(null, LocalDate.of(2026, 9, 30), LocalDate.of(2026, 7, 1)));
        assertEquals("FUNNEL_RANGE_INVALID", e.getErrorCode());
        assertTrue(db.calls.isEmpty());
    }

    @Test void thePeriodIsIndiaDaysEndInclusive() {
        FakeJdbc db = funnelDb(null, List.of(), 0, 0, null);
        new HiringInsightsService(db.jdbc).funnel(null, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30));
        var cohort = db.callsContaining("WITH cohort AS").get(0);
        assertEquals(java.sql.Timestamp.from(Instant.parse("2026-06-30T18:30:00Z")), cohort.args().get(1));
        assertEquals(java.sql.Timestamp.from(Instant.parse("2026-09-30T18:30:00Z")), cohort.args().get(2));
    }

    // ── my interviews ───────────────────────────────────────────────────────

    @Test void myInterviewsReadsMyRowsOnly() {
        UUID me = UUID.randomUUID();
        FakeJdbc db = new FakeJdbc().on("interview_interviewers", Map.of("took", 3L, "submitted", 2L, "due", 1L, "upcoming", 4L));
        var m = new HiringInsightsService(db.jdbc).myInterviews(me, LocalDate.of(2026, 9, 27));
        assertEquals(3, m.tookThisQuarter());
        assertEquals(2, m.scorecardsSubmittedThisQuarter());
        assertEquals(1, m.scorecardsDue());
        assertEquals(4, m.upcoming());
        assertTrue(db.calls.get(0).args().contains(me));
        assertTrue(db.calls.get(0).sql().contains("i.status = 'SCHEDULED'"), "cancelled interviews never count");
    }

    @Test void anAccountWithoutAnEmployeeRecordHasNoInterviews() {
        FakeJdbc db = new FakeJdbc();
        var m = new HiringInsightsService(db.jdbc).myInterviews(null, LocalDate.of(2026, 9, 27));
        assertEquals(0, m.tookThisQuarter() + m.upcoming() + m.scorecardsDue());
        assertTrue(db.calls.isEmpty());
    }
}
