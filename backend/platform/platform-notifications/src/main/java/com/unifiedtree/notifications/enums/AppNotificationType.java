package com.unifiedtree.notifications.enums;

/**
 * Canonical notification type catalog.
 *
 * <p>Persisted as the string value in {@code notif.notifications.type}. The mobile
 * client keeps an identical enum in {@code types/notification.types.ts}; keep the
 * two in sync — the mobile app dispatches deep-link routing off this value.
 *
 * <p>WFH_SUBMITTED / WFH_APPROVED are reserved for the not-yet-shipped
 * work-from-home module. When that module lands it should publish its own
 * {@code WfhRequestSubmittedEvent} / {@code WfhDecidedEvent} and add handlers in
 * {@code DomainEventListener}.
 */
public enum AppNotificationType {
    LEAVE_SUBMITTED,
    LEAVE_APPROVED,
    LEAVE_REJECTED,
    FACE_ENROLLMENT_COMPLETE,
    FACE_ENROLLMENT_FAILED,
    WFH_SUBMITTED,
    WFH_APPROVED,
    GENERAL
}
