package com.unifiedtree.notifications.enums;

/**
 * Canonical notification type catalog.
 *
 * <p>Persisted as the string value in {@code notif.notifications.type}. The mobile
 * client keeps an identical enum in {@code types/notification.types.ts}; keep the
 * two in sync — the mobile app dispatches deep-link routing off this value.
 *
 * <p>Each producer publishes a Spring {@code ApplicationEvent}; the handlers in
 * {@code DomainEventListener} map it to one of these types plus a {@code data.route}
 * deep-link the mobile client follows on tap.
 */
public enum AppNotificationType {
    LEAVE_SUBMITTED,
    LEAVE_APPROVED,
    LEAVE_REJECTED,
    LEAVE_CANCELLED,
    FACE_ENROLLMENT_COMPLETE,
    FACE_ENROLLMENT_FAILED,
    /** HR or an admin reset the employee's face enrollment; face punch-in is off until they enroll again. */
    FACE_ENROLLMENT_RESET,
    WFH_SUBMITTED,
    WFH_APPROVED,
    WFH_REJECTED,
    WFH_CANCELLED,
    CORRECTION_SUBMITTED,
    CORRECTION_APPROVED,
    CORRECTION_REJECTED,
    SHIFT_CHANGE_SUBMITTED,
    SHIFT_CHANGE_APPROVED,
    SHIFT_CHANGE_REJECTED,
    EXPENSE_SUBMITTED,
    EXPENSE_APPROVED,
    EXPENSE_REJECTED,
    ADVANCE_SUBMITTED,
    ADVANCE_APPROVED,
    ADVANCE_REJECTED,
    /** HR or finance raised a salary advance in the employee's name (it still needs approval). */
    ADVANCE_RAISED_FOR_YOU,
    /** The employee's salary structure was revised (bulk revision), from a stated date. */
    SALARY_REVISED,
    OVERTIME_APPROVED,
    OVERTIME_REJECTED,
    /** An employee asked for overtime on a day they chose (DECISIONS 22); sent to their approver. */
    OVERTIME_REQUESTED,
    /** A reviewer changed the employee's attendance status for a day (V143.10). */
    ATTENDANCE_STATUS_CHANGED,
    DOCUMENT_UPLOADED,
    DOCUMENT_VERIFIED,
    DOCUMENT_REJECTED,
    /** Leave encashment (V143.23): raised → HR; decided → the employee. */
    LEAVE_ENCASHMENT_SUBMITTED,
    LEAVE_ENCASHMENT_APPROVED,
    LEAVE_ENCASHMENT_REJECTED,
    /** A policy was published with "Email everyone"; sent with the email. */
    POLICY_PUBLISHED,
    /** A reminder to acknowledge a policy (manual "Remind" or the automatic one). */
    POLICY_REMINDER,
    // Hiring interviews (V143.20): sent to the interviewers.
    INTERVIEW_SCHEDULED,
    INTERVIEW_RESCHEDULED,
    INTERVIEW_CANCELLED,
    /** An employee proposed a skill level; sent to the manager or HR who approves it (V143.21). */
    SKILL_ASSESSMENT_SUBMITTED,
    /** The employee's proposed skill level was approved; their skill matrix is updated. */
    SKILL_ASSESSMENT_APPROVED,
    /** The employee's proposed skill level was not approved; the note says why. */
    SKILL_ASSESSMENT_REJECTED,
    WELCOME,
    TRIAL_ENDING_SOON,
    TRIAL_EXPIRED,
    SUBSCRIPTION_HALTED,          // autopay charge failed after Razorpay's retries; grace timer started
    /** Daily from 3 days before a subscription's due date: the autopay charge that is coming (owner rule, 6 Oct 2026). */
    PAYMENT_DUE_SOON,
    /** Daily while a charge is unpaid after its due date, until it is paid or the grace ends (owner rule, 6 Oct 2026). */
    PAYMENT_OVERDUE,
    /**
     * Workspace's active-employee count exceeds its paid seat cap. Fired for
     * <em>grandfathered</em> tenants only — those that were already over cap on
     * 2026-08-22 when {@code SeatQuotaEnforcer}'s hard 402 block shipped. New
     * tenants can never reach this state (they hit {@code SEAT_LIMIT_EXCEEDED}
     * on the very create that would put them over), so this alert is the ONLY
     * surface that tells the pre-existing over-cap workspaces to set up autopay
     * for the extras — client rule, Anil punchlist / 2026-08-22.
     *
     * <p>Emitted at most once per (tenant, calendar month) via the
     * {@code platform.seat_overage_notifications} dedup table; the deep-link
     * lands the admin on {@code /plan} where the matching amber warning banner
     * explains what action they need to take.
     *
     * <p>TODO(billing-ceiling): retire this once the Razorpay ceiling flow
     * ships — the intended long-term behaviour is that every tenant hits the
     * 402 the moment they'd exceed cap, no grandfather, no warning surface.
     */
    BILLING_OVER_CAP,
    /**
     * Someone reaches the company's retirement age in 90 (then 30) days. Sent by
     * the daily retirement alert job to people holding hrms.retirement.alerts.
     */
    RETIREMENT_DUE,

    // HRMS redesign (27 Sep 2026). Each one is sent only when a person does
    // something; no scheduled job sends them. The senders are built by the
    // redesign's page packages; the catalog entries are in NotificationEventCatalog.
    /** The person who approved or rejected a request took the decision back (approval Undo, within 10 minutes). */
    DECISION_UNDONE,
    /** A manager or HR reminded someone who hasn't checked in yet that day. */
    CHECKIN_REMINDER,
    /** HR pressed Remind on a review that is still to be written. */
    PERFORMANCE_REVIEW_REMINDER,
    /** A manager posted a message to their team. */
    TEAM_MESSAGE,
    /** An employee reported that an asset issued to them is lost, damaged or not working. */
    ASSET_ISSUE_REPORTED,
    /** An employee asked the payroll team a question about one of their payslips. */
    PAYSLIP_QUERY_RAISED,
    /** The payroll team answered an employee's payslip question. */
    PAYSLIP_QUERY_ANSWERED,
    /** HR or an admin applied for leave in the employee's name (it still needs approval). */
    LEAVE_APPLIED_ON_BEHALF,
    /** HR or finance raised an expense claim in the employee's name (it still needs approval). */
    EXPENSE_CLAIM_RAISED_FOR_YOU,
    /** Someone submitted a week of their timesheet; sent to the approver. */
    TIMESHEET_SUBMITTED,
    /** The employee's submitted timesheet week was approved or rejected. */
    TIMESHEET_DECIDED,
    /** HR sent a letter that asks for the employee's signature. */
    LETTER_SIGNATURE_REQUESTED,
    /** A manager confirmed or extended a team member's probation from Team today; sent to the employee and to HR. */
    PROBATION_TEAM_DECISION,

    /**
     * Someone punched in (punch-in alerts, V143.72): when, how and exactly where,
     * with a map link. Sent after the punch commits to the person's reporting
     * manager and to the people and roles the company chose in HR configuration.
     */
    PUNCH_IN_ALERT,

    /**
     * A colleague sent the employee wishes from Celebrations (V143.84): on their
     * birthday, their work anniversary, or to welcome them aboard, with a short
     * message. Sent only to that person.
     */
    CELEBRATION_WISH,

    /**
     * A shift roster the person is on was published with days for them from today on (shift
     * planning, V143.106): at the roster's first publish, or when they are added to it later.
     */
    ROSTER_PUBLISHED,
    /** A republished shift roster added, changed or removed one or more of the person's days. */
    ROSTER_DAY_CHANGED,

    GENERAL
}
