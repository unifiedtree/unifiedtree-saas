package com.hrms.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * When a decision may still be taken back, as plain checks with no database,
 * so each refusal is covered by a unit test. Each check answers null when Undo
 * may go ahead, or the refusal to send back (422 with a plain-English message,
 * 403 for someone who isn't the decider).
 */
final class UndoRules {

    private UndoRules() {
    }

    static HrmsException refusal(HttpStatus status, String code, String message) {
        return new HrmsException(message, status, code);
    }

    static HrmsException unprocessable(String code, String message) {
        return refusal(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
    }

    /** Only the person who decided may take it back. */
    static HrmsException notTheDecider(DecisionJournal.Entry e, UUID callerEmployeeId) {
        if (Objects.equals(e.decidedByEmployeeId(), callerEmployeeId)) return null;
        return refusal(HttpStatus.FORBIDDEN, "NOT_YOUR_DECISION", "Only the person who made this decision can take it back.");
    }

    /** A decision is taken back once. */
    static HrmsException alreadyUndone(DecisionJournal.Entry e) {
        if (e.undoneAt() == null) return null;
        return unprocessable("DECISION_ALREADY_UNDONE", "This decision has already been taken back.");
    }

    /** Ten minutes from the decision (DECISIONS 15). */
    static HrmsException windowPassed(DecisionJournal.Entry e, Instant now) {
        if (now.isBefore(e.undoUntil())) return null;
        return unprocessable("UNDO_WINDOW_PASSED", "The 10 minutes to take this decision back have passed.");
    }

    /**
     * The request must still be exactly as the decision left it: same status,
     * and (for the tables JPA maps) the same version; a shift change request
     * (JDBC only, no version) must be unchanged column for column.
     */
    static HrmsException changedSince(DecisionKind kind, JsonNode postRequest, DecisionStore.Snapshot current) {
        if (current == null) {
            return unprocessable("DECISION_CHANGED_SINCE", "This request no longer exists.");
        }
        String decided = DecisionStore.text(postRequest, "status");
        if (!Objects.equals(current.status(), decided)) {
            if ("CANCELLED".equals(current.status())) {
                return unprocessable("DECISION_CHANGED_SINCE",
                        "The request was cancelled after your decision, so there is nothing to take back.");
            }
            return unprocessable("DECISION_CHANGED_SINCE",
                    "This request has been decided again since your decision, so it can't be taken back.");
        }
        boolean same = DecisionStore.versioned(kind)
                ? Objects.equals(current.version(), postRequest.hasNonNull("version") ? postRequest.get("version").asLong() : null)
                : postRequest.equals(current.request());
        if (same) return null;
        return unprocessable("DECISION_CHANGED_SINCE",
                "This request has changed since your decision, so it can't be taken back.");
    }

    /** What a leave decision did to the balance: {@code post - prior} for used and pending. */
    record BalanceDelta(String balanceId, double used, double pending) {
        boolean none() {
            return used == 0 && pending == 0;
        }
    }

    /**
     * The balance change to reverse, or null when either snapshot has no
     * balance (nothing was changed on one) or they name different rows.
     */
    static BalanceDelta leaveBalanceDelta(JsonNode priorBalance, JsonNode postBalance) {
        if (priorBalance == null || postBalance == null || priorBalance.isMissingNode() || postBalance.isMissingNode()
                || priorBalance.isNull() || postBalance.isNull()) {
            return null;
        }
        String id = postBalance.path("id").asText();
        if (!id.equals(priorBalance.path("id").asText())) return null;
        return new BalanceDelta(id,
                postBalance.path("used").asDouble() - priorBalance.path("used").asDouble(),
                postBalance.path("pending").asDouble() - priorBalance.path("pending").asDouble());
    }

    /** Payroll for a day the decision covers is locked or paid. */
    static HrmsException payrollLocked(String lockedMonth) {
        if (lockedMonth == null) return null;
        return unprocessable("UNDO_PAYROLL_LOCKED",
                "Payroll for " + lockedMonth + " is already locked, so this decision can't be taken back.");
    }

    /** An approved work from home that has been used: the employee checked in from home. */
    static HrmsException wfhUsed(String employeeName, LocalDate firstWfhPunch) {
        if (firstWfhPunch == null) return null;
        return unprocessable("UNDO_WFH_USED", name(employeeName) + " has already checked in from home on "
                + DateText.longDay(firstWfhPunch) + ", so this approval can't be taken back.");
    }

    /** The attendance record an approved fix wrote must be unchanged since, and its overtime not yet decided. */
    static HrmsException correctionRecordUsed(JsonNode postRecord, JsonNode currentRecord, boolean overtimeDecided) {
        if (postRecord == null || postRecord.isNull() || postRecord.isMissingNode()) return null;
        if (currentRecord == null || currentRecord.isNull() || currentRecord.isMissingNode()
                || currentRecord.path("version").asLong() != postRecord.path("version").asLong()) {
            return unprocessable("DECISION_CHANGED_SINCE",
                    "The attendance for that day has changed since your decision, so it can't be taken back.");
        }
        if (overtimeDecided) {
            return unprocessable("UNDO_OVERTIME_DECIDED",
                    "Overtime for that day has already been approved or rejected, so this fix can't be taken back.");
        }
        return null;
    }

    /** The shift assignments must be exactly as the approval left them (the same rows, versions unchanged). */
    static HrmsException assignmentsChanged(JsonNode postAssignments, JsonNode currentAssignments) {
        Map<String, Long> post = DecisionStore.versions(postAssignments);
        Map<String, Long> now = DecisionStore.versions(currentAssignments);
        if (post.equals(now)) return null;
        return unprocessable("DECISION_CHANGED_SINCE",
                "Their shifts have been changed again since your decision, so it can't be taken back.");
    }

    /**
     * Shift change timing: an approved change can be taken back only before
     * the new shift starts (or on its first day, before they check in); a
     * reopened request must still be decidable (its start date not passed);
     * and there can't be another pending request (one pending per person).
     */
    static HrmsException shiftTiming(String decision, LocalDate appliedFrom, LocalDate requestedFrom, LocalDate today,
                                     boolean checkedInToday, boolean otherPending, String employeeName) {
        if (otherPending) {
            return unprocessable("UNDO_SHIFT_PENDING_EXISTS", name(employeeName)
                    + " has asked for another shift change since, so this one can't be reopened.");
        }
        if ("APPROVED".equals(decision)) {
            if (appliedFrom != null && appliedFrom.isBefore(today)) {
                return unprocessable("UNDO_SHIFT_STARTED", "The new shift started on " + DateText.longDay(appliedFrom)
                        + ", so this approval can't be taken back.");
            }
            if (appliedFrom != null && appliedFrom.equals(today) && checkedInToday) {
                return unprocessable("UNDO_SHIFT_STARTED", name(employeeName)
                        + " has already checked in on the new shift today, so this approval can't be taken back.");
            }
            return null;
        }
        if (requestedFrom != null && requestedFrom.isBefore(today)) {
            return unprocessable("UNDO_SHIFT_DATE_PASSED", "Its start date (" + DateText.longDay(requestedFrom)
                    + ") has passed, so it can't be reopened.");
        }
        return null;
    }

    /** An expense claim that went into a reimbursement batch has been used. */
    static HrmsException inReimbursementBatch(boolean inBatch) {
        if (!inBatch) return null;
        return unprocessable("UNDO_REIMBURSEMENT_BATCH",
                "This claim is already in a reimbursement batch, so this decision can't be taken back.");
    }

    private static String name(String employeeName) {
        return employeeName == null || employeeName.isBlank() ? "The employee" : employeeName;
    }
}
