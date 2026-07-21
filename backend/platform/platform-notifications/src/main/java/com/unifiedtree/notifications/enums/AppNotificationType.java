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
    GENERAL
}
