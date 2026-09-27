package com.hrms.api.ess.requests;

import com.hrms.api.ess.Rows;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Requests that are sent, then approved or rejected by one person: work from
 * home, attendance fixes and shift changes. Their statuses are PENDING,
 * APPROVED, REJECTED and CANCELLED.
 */
final class TwoStepRequests {

    private TwoStepRequests() {}

    /** What a two-step request row holds. */
    record Row(String kind, UUID id, String title, LocalDate from, LocalDate to, Double days, String status,
               Instant createdAt, Instant decidedAt, String approverName, boolean hasApprover, String link) {}

    /**
     * @param waitingFor who a waiting request is with: its approver when the row records one, else the
     *                   person its notification went to (fixes and shift changes); may be null
     */
    static MyRequest toRequest(Row r, String waitingFor) {
        String status = r.status() == null ? "" : r.status();
        Steps steps = new Steps().done("Sent", null, r.createdAt());
        String state, label, decidedBy = null, waiting = null;
        Instant last = r.createdAt();
        switch (status) {
            case "PENDING" -> {
                waiting = r.hasApprover() ? r.approverName() : waitingFor;
                steps.current("Approval", waiting);
                state = "WAITING";
                label = "Waiting";
            }
            case "APPROVED" -> {
                steps.done("Approval", r.approverName(), r.decidedAt());
                state = "APPROVED";
                label = "Approved";
                decidedBy = r.approverName();
                last = Rows.latest(r.createdAt(), r.decidedAt());
            }
            case "REJECTED" -> {
                // A shift change nobody decided before its start date is rejected by the system, with no approver.
                boolean expired = "SHIFT_CHANGE".equals(r.kind()) && !r.hasApprover();
                steps.done("Approval", r.approverName(), r.decidedAt());
                state = "REJECTED";
                label = expired ? "Expired" : "Rejected";
                decidedBy = r.approverName();
                last = Rows.latest(r.createdAt(), r.decidedAt());
            }
            case "CANCELLED" -> {
                steps.skipped("Approval");
                state = "CANCELLED";
                label = "Cancelled";
                last = Rows.latest(r.createdAt(), r.decidedAt());
            }
            default -> {
                steps.current("Approval", null);
                state = "WAITING";
                label = Rows.pretty(status);
            }
        }
        return new MyRequest(r.kind(), r.id(), r.title(), r.from(), r.to(), r.days(), null, null,
                status, state, label, steps.progress(!"WAITING".equals(state)), steps.list(), waiting, decidedBy,
                r.createdAt(), last, r.link());
    }
}
