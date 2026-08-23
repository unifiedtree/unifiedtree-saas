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
    WELCOME,
    TRIAL_ENDING_SOON,
    TRIAL_EXPIRED,
    SUBSCRIPTION_HALTED,          // autopay charge failed after Razorpay's retries; grace timer started
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
    GENERAL
}
