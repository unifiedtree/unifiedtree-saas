package com.hrms.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hrms.core.exception.HrmsException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Approval Undo: when a decision may be taken back, and the leave balance maths. */
class UndoRulesTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final UUID DECIDER = UUID.randomUUID();
    private static final Instant DECIDED = Instant.parse("2026-09-27T05:00:00Z");

    private static DecisionJournal.Entry entry(UUID decider, Instant undoneAt) {
        return new DecisionJournal.Entry(UUID.randomUUID(), DecisionKind.LEAVE, UUID.randomUUID(), UUID.randomUUID(),
                "APPROVED", "APPROVED", "DECISION", decider, DECIDED, DECIDED.plus(DecisionJournal.UNDO_WINDOW),
                "{}", "{}", 3L, null, null, undoneAt);
    }

    private static JsonNode json(String s) {
        try {
            return M.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static DecisionStore.Snapshot snapshot(String status, Long version, String request) {
        ObjectNode state = M.createObjectNode();
        state.set("request", json(request));
        return new DecisionStore.Snapshot(UUID.randomUUID(), UUID.randomUUID(), status, version, state);
    }

    // ── who and when ─────────────────────────────────────────────────────────

    @Test void onlyThePersonWhoDecidedCanTakeItBack() {
        assertNull(UndoRules.notTheDecider(entry(DECIDER, null), DECIDER));
        HrmsException refused = UndoRules.notTheDecider(entry(DECIDER, null), UUID.randomUUID());
        assertEquals(HttpStatus.FORBIDDEN, refused.getStatus());
        assertEquals("NOT_YOUR_DECISION", refused.getErrorCode());
    }

    @Test void aDecisionIsTakenBackOnce() {
        assertNull(UndoRules.alreadyUndone(entry(DECIDER, null)));
        HrmsException refused = UndoRules.alreadyUndone(entry(DECIDER, DECIDED.plusSeconds(60)));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, refused.getStatus());
        assertEquals("DECISION_ALREADY_UNDONE", refused.getErrorCode());
    }

    @Test void theWindowIsTenMinutes() {
        assertEquals(10, DecisionJournal.UNDO_WINDOW.toMinutes());
        DecisionJournal.Entry e = entry(DECIDER, null);
        assertNull(UndoRules.windowPassed(e, DECIDED.plusSeconds(9 * 60 + 59)));
        assertEquals("UNDO_WINDOW_PASSED", UndoRules.windowPassed(e, DECIDED.plusSeconds(600)).getErrorCode());
        assertEquals("UNDO_WINDOW_PASSED", UndoRules.windowPassed(e, DECIDED.plusSeconds(3600)).getErrorCode());
    }

    // ── the request as the decision left it ─────────────────────────────────

    @Test void aVersionedRequestMustBeUnchanged() {
        JsonNode post = json("{\"status\":\"APPROVED\",\"version\":4}");
        assertNull(UndoRules.changedSince(DecisionKind.LEAVE, post, snapshot("APPROVED", 4L, "{}")));
        assertEquals("DECISION_CHANGED_SINCE",
                UndoRules.changedSince(DecisionKind.LEAVE, post, snapshot("APPROVED", 5L, "{}")).getErrorCode());
        HrmsException cancelled = UndoRules.changedSince(DecisionKind.WFH, post, snapshot("CANCELLED", 5L, "{}"));
        assertTrue(cancelled.getMessage().contains("cancelled"));
        HrmsException decidedAgain = UndoRules.changedSince(DecisionKind.LEAVE, post, snapshot("REJECTED", 5L, "{}"));
        assertTrue(decidedAgain.getMessage().contains("decided again"));
        assertEquals("DECISION_CHANGED_SINCE", UndoRules.changedSince(DecisionKind.EXPENSE, post, null).getErrorCode());
    }

    @Test void aShiftChangeRequestHasNoVersionSoEveryColumnIsCompared() {
        String row = "{\"status\":\"APPROVED\",\"updated_at\":\"2026-09-27T10:00:00+05:30\",\"applied_effective_date\":\"2026-10-05\"}";
        JsonNode post = json(row);
        assertNull(UndoRules.changedSince(DecisionKind.SHIFT_CHANGE, post, snapshot("APPROVED", null, row)));
        String touched = row.replace("10:00:00", "10:04:00");
        assertEquals("DECISION_CHANGED_SINCE",
                UndoRules.changedSince(DecisionKind.SHIFT_CHANGE, post, snapshot("APPROVED", null, touched)).getErrorCode());
    }

    // ── leave balance maths ──────────────────────────────────────────────────

    @Test void undoingAnApprovalMovesTheDaysFromUsedBackToPending() {
        // approved 2 days: used 2 → 4, pending 3 → 1
        UndoRules.BalanceDelta d = UndoRules.leaveBalanceDelta(
                json("{\"id\":\"b1\",\"used\":2,\"pending\":3}"), json("{\"id\":\"b1\",\"used\":4,\"pending\":1}"));
        assertEquals("b1", d.balanceId());
        assertEquals(2.0, d.used());
        assertEquals(-2.0, d.pending());
        // the store applies used -= 2 and pending -= -2: back to used 2, pending 3
        assertEquals(2.0, 4 - d.used());
        assertEquals(3.0, 1 - d.pending());
    }

    @Test void undoingARejectionPutsTheDaysBackOnPending() {
        UndoRules.BalanceDelta d = UndoRules.leaveBalanceDelta(
                json("{\"id\":\"b1\",\"used\":0,\"pending\":3}"), json("{\"id\":\"b1\",\"used\":0,\"pending\":1}"));
        assertEquals(0.0, d.used());
        assertEquals(-2.0, d.pending());
    }

    @Test void aHalfDayMovesHalfADay() {
        UndoRules.BalanceDelta d = UndoRules.leaveBalanceDelta(
                json("{\"id\":\"b1\",\"used\":1,\"pending\":0.5}"), json("{\"id\":\"b1\",\"used\":1.5,\"pending\":0}"));
        assertEquals(0.5, d.used());
        assertEquals(-0.5, d.pending());
    }

    @Test void aFirstLevelApprovalChangesNoBalance() {
        UndoRules.BalanceDelta d = UndoRules.leaveBalanceDelta(
                json("{\"id\":\"b1\",\"used\":2,\"pending\":3}"), json("{\"id\":\"b1\",\"used\":2,\"pending\":3}"));
        assertTrue(d.none());
    }

    @Test void noBalanceOrADifferentRowMeansNothingToReverse() {
        assertNull(UndoRules.leaveBalanceDelta(null, json("{\"id\":\"b1\",\"used\":1,\"pending\":0}")));
        assertNull(UndoRules.leaveBalanceDelta(json("{\"id\":\"b1\"}"), M.nullNode()));
        assertNull(UndoRules.leaveBalanceDelta(json("{\"id\":\"b1\",\"used\":1,\"pending\":0}"),
                json("{\"id\":\"b2\",\"used\":2,\"pending\":0}")));
    }

    // ── what has used a decision ─────────────────────────────────────────────

    @Test void lockedOrPaidPayrollRefuses() {
        assertNull(UndoRules.payrollLocked(null));
        HrmsException refused = UndoRules.payrollLocked("Sep 2026");
        assertEquals("UNDO_PAYROLL_LOCKED", refused.getErrorCode());
        assertTrue(refused.getMessage().contains("Sep 2026"));
    }

    @Test void aWorkFromHomeCheckInRefuses() {
        assertNull(UndoRules.wfhUsed("Ravi Kumar", null));
        HrmsException refused = UndoRules.wfhUsed("Ravi Kumar", LocalDate.of(2026, 9, 30));
        assertEquals("UNDO_WFH_USED", refused.getErrorCode());
        assertTrue(refused.getMessage().startsWith("Ravi Kumar has already checked in from home on 30 Sep 2026"));
    }

    @Test void aFixedDayThatChangedOrHadOvertimeDecidedRefuses() {
        JsonNode post = json("{\"id\":\"r1\",\"version\":2}");
        assertNull(UndoRules.correctionRecordUsed(post, json("{\"id\":\"r1\",\"version\":2}"), false));
        assertEquals("DECISION_CHANGED_SINCE",
                UndoRules.correctionRecordUsed(post, json("{\"id\":\"r1\",\"version\":3}"), false).getErrorCode());
        assertEquals("DECISION_CHANGED_SINCE", UndoRules.correctionRecordUsed(post, M.nullNode(), false).getErrorCode());
        assertEquals("UNDO_OVERTIME_DECIDED",
                UndoRules.correctionRecordUsed(post, json("{\"id\":\"r1\",\"version\":2}"), true).getErrorCode());
        // a rejection wrote no record: nothing to check
        assertNull(UndoRules.correctionRecordUsed(M.nullNode(), M.nullNode(), true));
    }

    @Test void shiftAssignmentsChangedSinceRefuses() {
        JsonNode post = json("[{\"id\":\"a1\",\"version\":1},{\"id\":\"a2\",\"version\":0}]");
        assertNull(UndoRules.assignmentsChanged(post, json("[{\"id\":\"a2\",\"version\":0},{\"id\":\"a1\",\"version\":1}]")));
        assertNotNull(UndoRules.assignmentsChanged(post, json("[{\"id\":\"a1\",\"version\":2},{\"id\":\"a2\",\"version\":0}]")));
        assertNotNull(UndoRules.assignmentsChanged(post, json("[{\"id\":\"a1\",\"version\":1}]")));
        assertNotNull(UndoRules.assignmentsChanged(post,
                json("[{\"id\":\"a1\",\"version\":1},{\"id\":\"a2\",\"version\":0},{\"id\":\"a3\",\"version\":0}]")));
    }

    @Test void shiftChangeTiming() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        // approved, starts tomorrow: fine
        assertNull(UndoRules.shiftTiming("APPROVED", today.plusDays(1), today.plusDays(1), today, false, false, "Ravi"));
        // approved, started yesterday
        assertEquals("UNDO_SHIFT_STARTED",
                UndoRules.shiftTiming("APPROVED", today.minusDays(1), today.minusDays(1), today, false, false, "Ravi").getErrorCode());
        // approved, starts today: fine until they check in on it
        assertNull(UndoRules.shiftTiming("APPROVED", today, today, today, false, false, "Ravi"));
        HrmsException punched = UndoRules.shiftTiming("APPROVED", today, today, today, true, false, "Ravi");
        assertEquals("UNDO_SHIFT_STARTED", punched.getErrorCode());
        assertTrue(punched.getMessage().startsWith("Ravi has already checked in"));
        // another pending request blocks reopening (one pending request per person)
        assertEquals("UNDO_SHIFT_PENDING_EXISTS",
                UndoRules.shiftTiming("REJECTED", null, today.plusDays(3), today, false, true, "Ravi").getErrorCode());
        // a rejection can be reopened only while its start date hasn't passed
        assertNull(UndoRules.shiftTiming("REJECTED", null, today, today, false, false, "Ravi"));
        assertNull(UndoRules.shiftTiming("REJECTED", null, null, today, false, false, "Ravi"));
        assertEquals("UNDO_SHIFT_DATE_PASSED",
                UndoRules.shiftTiming("REJECTED", null, today.minusDays(1), today, false, false, "Ravi").getErrorCode());
    }

    @Test void aClaimInAReimbursementBatchRefuses() {
        assertNull(UndoRules.inReimbursementBatch(false));
        assertEquals("UNDO_REIMBURSEMENT_BATCH", UndoRules.inReimbursementBatch(true).getErrorCode());
    }
}
