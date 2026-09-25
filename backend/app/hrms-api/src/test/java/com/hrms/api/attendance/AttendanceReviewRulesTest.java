package com.hrms.api.attendance;

import com.hrms.attendance.policy.EffectiveDay;
import com.hrms.attendance.dto.StaffStatusResponse;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Review list, record write-back, roster words and proof checks (V143.10). */
class AttendanceReviewRulesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 25);
    private static final LocalDate YESTERDAY = TODAY.minusDays(1);
    private static final Instant IN = Instant.parse("2026-09-24T04:30:00Z");

    private static EffectiveDay day(String status, Instant in, Instant out, Integer late, boolean early, boolean outside,
                                    boolean manual, boolean rejected, String type) {
        return new EffectiveDay(UUID.randomUUID(), YESTERDAY, status, status, in, out, type, late, null, early,
                early ? 30 : null, false, null, null, null, false, 1.0, manual, manual ? "SET" : null, null, null, null,
                rejected, outside, outside ? 300 : null, null, null, null, 15, null);
    }

    @Test
    void exceptionFlagsCoverWhatNeedsALook() {
        assertEquals(List.of("LATE"), AttendanceReviewService.flags(day("LATE", IN, IN.plusSeconds(30000), 40, false, false, false, false, "OFFICE"), TODAY));
        assertEquals(List.of("ABSENT"), AttendanceReviewService.flags(day("ABSENT", null, null, null, false, false, false, false, null), TODAY));
        assertEquals(List.of("EARLY_LEAVE", "OUTSIDE_ZONE"),
                AttendanceReviewService.flags(day("PRESENT", IN, IN.plusSeconds(20000), null, true, true, false, false, "OFFICE"), TODAY));
        assertEquals(List.of("NO_CHECKOUT"), AttendanceReviewService.flags(day("PRESENT", IN, null, null, false, false, false, false, "OFFICE"), TODAY));
        assertTrue(AttendanceReviewService.flags(day("PRESENT", IN, IN.plusSeconds(32000), null, false, false, false, false, "OFFICE"), TODAY).isEmpty());
    }

    @Test
    void faceStatusNeedsALookForMediumAndLowMatches() {
        assertEquals("REVIEW", AttendanceReviewService.faceStatus("PASS", "MEDIUM", null));
        assertEquals("REVIEW", AttendanceReviewService.faceStatus("PASS", "LOW", null));
        assertEquals("OK", AttendanceReviewService.faceStatus("PASS", "HIGH", null));
        assertEquals("CONFIRMED", AttendanceReviewService.faceStatus("PASS", "MEDIUM", "CONFIRMED"));
        assertEquals("FLAGGED", AttendanceReviewService.faceStatus("PASS", "HIGH", "REJECTED"));
        assertEquals("FAILED", AttendanceReviewService.faceStatus("FAIL_MATCH", "LOW", null));
    }

    @Test
    void theRecordGetsTheManualOrRejectedStatus() {
        assertEquals("HALF_DAY", AttendanceReviewService.recordStatusFor(day("HALF_DAY", IN, null, null, false, false, true, false, "OFFICE"), YESTERDAY, TODAY));
        assertEquals("ABSENT", AttendanceReviewService.recordStatusFor(day("ABSENT", IN, null, null, false, false, false, true, "OFFICE"), YESTERDAY, TODAY));
        assertEquals("NOT_MARKED", AttendanceReviewService.recordStatusFor(day("NOT_MARKED", IN, null, null, false, false, false, true, "OFFICE"), TODAY, TODAY));
        assertEquals("LATE", AttendanceReviewService.recordStatusFor(day("PRESENT", IN, null, 25, false, false, false, false, "OFFICE"), YESTERDAY, TODAY));
        assertEquals("ON_TIME", AttendanceReviewService.recordStatusFor(day("PRESENT", IN, null, null, false, false, false, false, "OFFICE"), YESTERDAY, TODAY));
    }

    @Test
    void rangeIsClampedToTodayAndTheMaximum() {
        LocalDate[] r = AttendanceReviewService.range(TODAY.minusYears(1), TODAY.plusDays(5), TODAY.minusDays(6), TODAY);
        assertEquals(TODAY, r[1]);
        assertEquals(TODAY.minusDays(AttendanceReviewService.MAX_RANGE_DAYS - 1L), r[0]);
        LocalDate[] swapped = AttendanceReviewService.range(TODAY, TODAY.minusDays(3), null, TODAY);
        assertEquals(TODAY.minusDays(3), swapped[0]);
    }

    @Test
    void rosterWordsStayTheMobileAppsWords() {
        assertEquals("ON_TIME", AttendanceController.legacyStatus(day("PRESENT", IN, null, null, false, false, false, false, "OFFICE")));
        assertEquals("PRESENT", AttendanceController.legacyStatus(day("PRESENT", IN, null, 20, false, false, false, false, "OFFICE")), "late within the allowance");
        assertEquals("NOT_MARKED", AttendanceController.legacyStatus(day("ABSENT", null, null, null, false, false, false, false, null)));
        assertEquals("ABSENT", AttendanceController.legacyStatus(day("ABSENT", IN, null, null, false, false, true, false, "OFFICE")));
        assertEquals("HALF_DAY", AttendanceController.legacyStatus(day("HALF_DAY", IN, null, 90, false, false, false, false, "OFFICE")));
        assertEquals("NOT_MARKED", AttendanceController.legacyStatus(day("ON_LEAVE", null, null, null, false, false, false, false, null)));
    }

    private static StaffStatusResponse row(UUID id, String status, String type, boolean early) {
        return new StaffStatusResponse(id, "E", "Name", null, null, null, null, status, null, null, null, null, null,
                early, type, false, null, null, null, null, null, null, false, false, false, false, false, null, null);
    }

    @Test
    void tilesAddUpFromTheRows() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID(), c = UUID.randomUUID(), d = UUID.randomUUID(), e = UUID.randomUUID();
        var counts = AttendanceController.countSummaryFromRows(List.of(
                row(a, "ON_TIME", "OFFICE", true), row(b, "LATE", "WFH", false), row(c, "HALF_DAY", "OFFICE", false),
                row(d, "NOT_MARKED", null, false), row(e, "NOT_MARKED", null, false)), Set.of(e));
        assertEquals(1, counts.present());
        assertEquals(1, counts.late());
        assertEquals(1, counts.halfDay());
        assertEquals(1, counts.workFromHome());
        assertEquals(2, counts.notMarked());
        assertEquals(1, counts.absent());
        assertEquals(1, counts.onLeave());
        assertEquals(1, counts.earlyCheckout());
    }

    private static StaffStatusResponse effRow(UUID id, String status, String effective) {
        return new StaffStatusResponse(id, "E", "Name", null, null, null, null, status, null, null, null, null, null,
                false, null, false, null, null, null, null, effective, null, false, false, false, false, false, null, null);
    }

    @Test
    void offDaysAreNotCountedAsNotMarkedOrAbsent() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID(), c = UUID.randomUUID(), d = UUID.randomUUID();
        var counts = AttendanceController.countSummaryFromRows(List.of(
                effRow(a, "NOT_MARKED", "HOLIDAY"), effRow(b, "NOT_MARKED", "NOT_TRACKED"),
                effRow(c, "NOT_MARKED", "ABSENT"), effRow(d, "ON_TIME", "PRESENT")), Set.of());
        assertEquals(1, counts.present());
        assertEquals(1, counts.notMarked(), "only the real absence");
        assertEquals(1, counts.absent());
    }

    @Test
    void trendCountsEachPersonOnce() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID(), c = UUID.randomUUID();
        var eff = Map.of(
                a, Map.of(YESTERDAY, day("PRESENT", IN, null, null, false, false, false, false, "WFH")),
                b, Map.of(YESTERDAY, day("LATE", IN, null, 30, false, false, false, false, "WFH")),
                c, Map.of(YESTERDAY, day("ON_LEAVE", null, null, null, false, false, false, false, null)));
        var counts = AttendanceController.effectiveCounts(YESTERDAY, List.of(a, b, c), 0, eff, List.of());
        assertEquals(1, counts.workFromHome());
        assertEquals(1, counts.late());
        assertEquals(0, counts.present());
        assertEquals(1, counts.onLeave());
        assertEquals(1, counts.notMarked());
        assertEquals(0, counts.absent());
        // w2f's per-day totals (V143.25): the late WFH person is counted once.
        assertEquals(2, counts.checkedIn());
        assertEquals(1, counts.workFromHomeOnTime());
        assertEquals(3, counts.scheduled());
        assertFalse(counts.weeklyOffDay());
    }

    @Test
    void trendMarksADayEveryoneHasOffAsAWeeklyOff() {
        var counts = AttendanceController.effectiveCounts(YESTERDAY, List.of(), 4, Map.of(), List.of());
        assertEquals(0, counts.scheduled());
        assertEquals(4, counts.weeklyOff());
        assertTrue(counts.weeklyOffDay());
    }

    @Test
    void proofMustBeTheEmployeesOwnFile() {
        String own = "attendance-proofs/t1/e1/";
        assertNull(CorrectionProofController.attachmentProblem(null, own));
        assertNull(CorrectionProofController.attachmentProblem("r2://attendance-proofs/t1/e1/x/gate.pdf", own));
        assertNull(CorrectionProofController.attachmentProblem("https://example.com/gate.pdf", own));
        assertNotNull(CorrectionProofController.attachmentProblem("r2://attendance-proofs/t1/e2/x/gate.pdf", own));
        assertNotNull(CorrectionProofController.attachmentProblem("r2://attendance-proofs/t1/e1/../e2/x.pdf", own));
        assertNotNull(CorrectionProofController.attachmentProblem("javascript:alert(1)", own));
    }

    @Test
    void proofFilesAreSniffedAndNamedSafely() {
        assertEquals("application/pdf", CorrectionProofController.contentTypeOf("%PDF-1.4".getBytes()));
        assertEquals("image/png", CorrectionProofController.contentTypeOf(new byte[]{(byte) 137, 80, 78, 71, 13, 10, 26, 10}));
        assertEquals("image/jpeg", CorrectionProofController.contentTypeOf(new byte[]{(byte) 255, (byte) 216, (byte) 255, 0}));
        assertNull(CorrectionProofController.contentTypeOf("<html>".getBytes()));
        assertEquals("gate-log.pdf", CorrectionProofController.safeName("C:\\Users\\me\\gate log.exe", "pdf"));
        assertEquals("proof.jpg", CorrectionProofController.safeName("../..", "jpg"));
    }
}
