package com.hrms.api.hiring;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class InterviewRulesTest {

    private static final Instant NOW = Instant.parse("2026-09-25T06:00:00Z"); // 11:30 IST
    private static final UUID A = UUID.randomUUID(), B = UUID.randomUUID();

    private static InterviewRules.Schedule schedule(LocalDateTime at, String mode, String location, List<UUID> people) {
        return new InterviewRules.Schedule("  Technical round ", at, 60, mode, location, people, null, null);
    }

    private static String code(Runnable r) {
        return assertThrows(BusinessRuleException.class, r::run).getErrorCode();
    }

    @Test
    void istWallClockIsStoredAsTheRightInstant() {
        var clean = InterviewRules.clean(schedule(LocalDateTime.parse("2026-09-26T10:30"), "video", "https://meet.example.com/abc", List.of(A)), NOW);
        assertEquals(Instant.parse("2026-09-26T05:00:00Z"), clean.scheduledAt());
        assertEquals("VIDEO", clean.mode());
        assertEquals("Technical round", clean.title());
        assertEquals(LocalDateTime.parse("2026-09-26T10:30"), InterviewRules.instantToIst(clean.scheduledAt()));
        assertEquals(InterviewRules.DEFAULT_CRITERIA, clean.criteria());
    }

    @Test
    void pastTimesAndOddDurationsAreRefused() {
        // 11:00 IST today is before "now" (11:30 IST), even though it is later than 11:00 UTC would suggest.
        assertEquals("INTERVIEW_TIME_PAST", code(() -> InterviewRules.clean(schedule(LocalDateTime.parse("2026-09-25T11:00"), "PHONE", null, List.of(A)), NOW)));
        assertEquals("INTERVIEW_TIME_TOO_FAR", code(() -> InterviewRules.clean(schedule(LocalDateTime.parse("2027-12-01T10:00"), "PHONE", null, List.of(A)), NOW)));
        assertEquals("INTERVIEW_DURATION_INVALID", code(() -> InterviewRules.clean(new InterviewRules.Schedule(null, LocalDateTime.parse("2026-09-26T10:00"), 5, "PHONE", null, List.of(A), null, null), NOW)));
        assertEquals("INTERVIEW_TIME_REQUIRED", code(() -> InterviewRules.clean(schedule(null, "PHONE", null, List.of(A)), NOW)));
    }

    @Test
    void modeDecidesWhatLocationIsNeeded() {
        LocalDateTime at = LocalDateTime.parse("2026-09-26T10:00");
        assertEquals("INTERVIEW_LOCATION_REQUIRED", code(() -> InterviewRules.clean(schedule(at, "IN_PERSON", " ", List.of(A)), NOW)));
        assertEquals("INTERVIEW_LINK_REQUIRED", code(() -> InterviewRules.clean(schedule(at, "VIDEO", null, List.of(A)), NOW)));
        assertEquals("INTERVIEW_LINK_INVALID", code(() -> InterviewRules.clean(schedule(at, "VIDEO", "meet.example.com/abc", List.of(A)), NOW)));
        assertEquals("INTERVIEW_MODE_INVALID", code(() -> InterviewRules.clean(schedule(at, "CARRIER_PIGEON", "x", List.of(A)), NOW)));
        assertNull(InterviewRules.clean(schedule(at, "PHONE", null, List.of(A)), NOW).location());
        assertEquals("Board room 2", InterviewRules.clean(schedule(at, "IN_PERSON", " Board room 2 ", List.of(A)), NOW).location());
    }

    @Test
    void interviewersAreRequiredDeduplicatedAndCapped() {
        LocalDateTime at = LocalDateTime.parse("2026-09-26T10:00");
        assertEquals("INTERVIEW_INTERVIEWERS_REQUIRED", code(() -> InterviewRules.clean(schedule(at, "PHONE", null, List.of()), NOW)));
        assertEquals(List.of(A, B), InterviewRules.clean(schedule(at, "PHONE", null, List.of(A, B, A)), NOW).interviewerIds());
        List<UUID> eleven = java.util.stream.Stream.generate(UUID::randomUUID).limit(11).toList();
        assertEquals("INTERVIEW_TOO_MANY_INTERVIEWERS", code(() -> InterviewRules.clean(schedule(at, "PHONE", null, eleven), NOW)));
    }

    @Test
    void criteriaAreTrimmedAndDeduplicatedIgnoringCase() {
        assertEquals(List.of("Coding", "System design"), InterviewRules.criteria(List.of(" Coding ", "coding", "", "System design")));
        assertEquals(InterviewRules.DEFAULT_CRITERIA, InterviewRules.criteria(List.of(" ", "")));
    }

    @Test
    void onlyScreeningAndInterviewStagesCanBeBooked() {
        InterviewRules.assertStageAllowsScheduling("SCREENING");
        InterviewRules.assertStageAllowsScheduling("INTERVIEW");
        for (String stage : List.of("APPLIED", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"))
            assertEquals("INTERVIEW_STAGE_INVALID", code(() -> InterviewRules.assertStageAllowsScheduling(stage)));
    }

    @Test
    void everyCriterionMustBeRatedOneToFive() {
        List<String> criteria = List.of("Coding", "Communication");
        assertEquals(new BigDecimal("3.50"), InterviewRules.overall(criteria, List.of(new InterviewRules.Rating("coding", 4), new InterviewRules.Rating("Communication", 3))));
        assertEquals("SCORECARD_RATING_MISSING", code(() -> InterviewRules.overall(criteria, List.of(new InterviewRules.Rating("Coding", 4)))));
        assertEquals("SCORECARD_RATING_RANGE", code(() -> InterviewRules.overall(criteria, List.of(new InterviewRules.Rating("Coding", 6), new InterviewRules.Rating("Communication", 3)))));
        assertEquals("SCORECARD_CRITERION_UNKNOWN", code(() -> InterviewRules.overall(criteria, List.of(new InterviewRules.Rating("Coding", 4), new InterviewRules.Rating("Vibes", 3)))));
        assertEquals("SCORECARD_RATING_DUPLICATE", code(() -> InterviewRules.overall(criteria, List.of(new InterviewRules.Rating("Coding", 4), new InterviewRules.Rating("CODING", 3)))));
        assertEquals("SCORECARD_RATINGS_REQUIRED", code(() -> InterviewRules.overall(criteria, List.of())));
    }

    @Test
    void recommendationAcceptsTheFourAnswers() {
        assertEquals("STRONG_YES", InterviewRules.recommendation("strong yes"));
        assertEquals("NO", InterviewRules.recommendation("NO"));
        assertEquals("SCORECARD_RECOMMENDATION_INVALID", code(() -> InterviewRules.recommendation("maybe")));
    }

    @Test
    void summaryAveragesAndTallies() {
        var s = InterviewRules.summarise(List.of(new BigDecimal("4.00"), new BigDecimal("3.50")), List.of("YES", "STRONG_YES"));
        assertEquals(2, s.count());
        assertEquals(new BigDecimal("3.75"), s.averageRating());
        assertEquals(1, s.recommendations().get("YES"));
        assertEquals(1, s.recommendations().get("STRONG_YES"));
        assertEquals(0, s.recommendations().get("NO"));
        var none = InterviewRules.summarise(List.of(), List.of());
        assertEquals(0, none.count());
        assertNull(none.averageRating());
    }

    @Test
    void diffTellsWhoToNotify() {
        UUID c = UUID.randomUUID();
        var d = InterviewRules.diff(List.of(A, B), List.of(B, c), true);
        assertEquals(List.of(c), d.added());
        assertEquals(List.of(A), d.removed());
        assertEquals(List.of(B), d.kept());
        assertTrue(d.detailsChanged());
    }
}
