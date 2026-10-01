package com.hrms.api.ess.requests;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * One of the caller's own requests on Home's "My requests" (BW-119), whatever
 * its kind. Everything is read from the request itself; nothing is made up:
 * a person is named only where the request records them.
 *
 * @param kind           LEAVE, WFH, CORRECTION, SHIFT_CHANGE, EXPENSE, ADVANCE or TIMESHEET
 * @param id             the request's id on its own page
 * @param title          the request in a few words: the leave type, "Work from home",
 *                       "Attendance fix", "Shift change to Morning", a claim's title, "Salary advance"
 * @param fromDate       first day it covers (leave, WFH, the fixed day, a shift change's start); null otherwise
 * @param toDate         last day it covers; null when it has no days
 * @param days           leave: its total days; WFH: days in the request; null otherwise
 * @param amount         expense claims and advances; null otherwise
 * @param currency       with the amount
 * @param status         the request's own status, as its page shows it (PENDING, PENDING_L2, SUBMITTED, …)
 * @param state          the same, for Home's pill: WAITING, APPROVED, DONE, REJECTED or CANCELLED
 * @param statusLabel    plain words for the status: "Waiting", "Waiting for HR", "Reimbursed", …
 * @param progress       0–100: the share of its steps that are done
 * @param steps          the request's steps in order
 * @param waitingForName while it waits: who has it (the approver it was sent to, or for a fix or shift
 *                       change the person told about it); null when it waits for a group (HR) or nobody is recorded
 * @param decidedByName  who approved or rejected it; null while it waits, or when nobody is recorded
 * @param createdAt      when it was sent
 * @param lastActivityAt its latest change (decided, paid, cancelled), else when it was sent
 * @param link           the web page that lists it
 */
public record MyRequest(
        String kind,
        UUID id,
        String title,
        LocalDate fromDate,
        LocalDate toDate,
        Double days,
        BigDecimal amount,
        String currency,
        String status,
        String state,
        String statusLabel,
        int progress,
        List<Step> steps,
        String waitingForName,
        String decidedByName,
        Instant createdAt,
        Instant lastActivityAt,
        String link) {

    /**
     * One step of a request.
     *
     * @param label      "Sent", "Approval", "HR approval", "Paid", "Paid out", "Repaid"
     * @param state      DONE, CURRENT (where it is now), TODO, or SKIPPED (it ended before this step)
     * @param personName who did it, or who has it now; null when not recorded
     * @param at         when it was done; null when not done or not recorded
     */
    public record Step(String label, String state, String personName, Instant at) {}

    /** Home's answer: the newest requests, waiting ones first, and the sources that could not be read. */
    public record Response(List<MyRequest> requests, List<String> included, List<String> unavailable) {}
}
