package com.hrms.api.approvals;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * What the Approvals inbox shows one caller, decided exactly as each kind's
 * own list and decide endpoints decide it today:
 *
 * <table>
 *   <tr><th>Kind</th><th>Listed with (list endpoint)</th><th>Scope</th><th>Decide check</th></tr>
 *   <tr><td>Leave</td><td>@perm.check hrms.leave.approve.l1 (/v1/leave/approvals/pending)</td>
 *       <td>hrms.leave.approve.l2 → every pending request in the tenant; else approver, reporting manager
 *       or department head is the caller</td><td>ApproverScopeGuard: l2 → anyone, else the caller's team</td></tr>
 *   <tr><td>Work from home</td><td>wfh.approve (/v1/wfh/pending-approvals)</td><td>as leave</td><td>as leave</td></tr>
 *   <tr><td>Attendance fix</td><td>attendance.regularization.approve (/v1/attendance/corrections/approvals)</td>
 *       <td>the caller's team (TeamEmployeeScope)</td><td>ApproverScopeGuard</td></tr>
 *   <tr><td>Shift change</td><td>attendance.regularization.approve (/v1/shifts/change-requests/pending)</td>
 *       <td>attendance.workforce.admin → the tenant; else the team</td><td>the same scope</td></tr>
 *   <tr><td>Timesheet week</td><td>@perm.check hrms.timesheet.approve (/v1/timesheets/approvals, SUBMITTED)</td>
 *       <td>the caller's team (TeamEmployeeScope)</td><td>the same scope</td></tr>
 *   <tr><td>Expense</td><td>hrms.expense.claim.approve (/v1/expense/claims/approvals, SUBMITTED only)</td>
 *       <td>hrms.expense.reimbursement → the tenant; else claims routed to the caller</td>
 *       <td>@perm.check hrms.expense.claim.approve + the same scope</td></tr>
 * </table>
 *
 * The caller's own requests are always left out. A row the caller can list
 * but not decide (a leave or WFH request routed to them that ApproverScopeGuard
 * refuses) comes back with {@code canDecide=false}; the guard is not widened.
 */
public record InboxAccess(UUID me, boolean leave, boolean wfh, boolean corrections, boolean shifts, boolean expenses,
                          boolean leaveL2, boolean workforceAdmin, boolean reimbursement, boolean expenseDecide,
                          boolean timesheets) {

    /** The design's tabs, in its order. */
    public static final List<String> TAB_ORDER = List.of("all", "leave", "attendance", "requests", "expenses");

    public boolean any() {
        return leave || wfh || corrections || shifts || expenses || timesheets;
    }

    /** The tabs this caller may open; "all" whenever any other is there. */
    public List<String> tabs() {
        List<String> out = new ArrayList<>();
        if (!any()) return out;
        out.add("all");
        if (leave) out.add("leave");
        if (corrections) out.add("attendance");
        if (wfh || shifts || timesheets) out.add("requests");
        if (expenses) out.add("expenses");
        return out;
    }

    /** The kinds a tab covers for this caller. */
    public List<DecisionKind> kinds(String tab) {
        List<DecisionKind> out = new ArrayList<>();
        boolean all = "all".equals(tab);
        if (leave && (all || "leave".equals(tab))) out.add(DecisionKind.LEAVE);
        if (corrections && (all || "attendance".equals(tab))) out.add(DecisionKind.CORRECTION);
        if (wfh && (all || "requests".equals(tab))) out.add(DecisionKind.WFH);
        if (shifts && (all || "requests".equals(tab))) out.add(DecisionKind.SHIFT_CHANGE);
        if (expenses && (all || "expenses".equals(tab))) out.add(DecisionKind.EXPENSE);
        return out;
    }

    /** Whether a tab shows submitted timesheet weeks (under Requests; not an undoable kind). */
    public boolean timesheetsIn(String tab) {
        return timesheets && ("all".equals(tab) || "requests".equals(tab));
    }

    /**
     * Whether POST /v1/timesheets/weeks/{id}/decision would accept this caller:
     * never their own week, and only for someone in their team scope (the same
     * scope the timesheet approvals list reads).
     */
    public boolean canDecideTimesheet(UUID requesterId, Set<UUID> team) {
        return timesheets && requesterId != null && !requesterId.equals(me) && team.contains(requesterId);
    }

    /** The tab a kind is counted under. */
    public static String tabOf(DecisionKind kind) {
        return switch (kind) {
            case LEAVE -> "leave";
            case CORRECTION -> "attendance";
            case WFH, SHIFT_CHANGE -> "requests";
            case EXPENSE -> "expenses";
        };
    }

    /**
     * Whether the kind's decide endpoint would accept this caller for a row
     * they can list. {@code team} is TeamEmployeeScope for the caller;
     * {@code approverId} is the expense claim's approver.
     */
    public boolean canDecide(DecisionKind kind, UUID requesterId, UUID approverId, Set<UUID> team) {
        if (requesterId == null || requesterId.equals(me)) return false;
        return switch (kind) {
            case LEAVE, WFH -> leaveL2 || team.contains(requesterId);
            // Listed from the team (ApproverScopeGuard's own team) or, for shift changes,
            // from ShiftController.approverScope, which the decision uses too.
            case CORRECTION -> leaveL2 || team.contains(requesterId);
            case SHIFT_CHANGE -> workforceAdmin || team.contains(requesterId);
            case EXPENSE -> expenseDecide && (reimbursement || me.equals(approverId));
        };
    }

    /** Work from home needs a reason to reject (WfhController: WFH_REJECT_REASON_REQUIRED). */
    public static boolean rejectNeedsReason(DecisionKind kind) {
        return kind == DecisionKind.WFH;
    }
}
