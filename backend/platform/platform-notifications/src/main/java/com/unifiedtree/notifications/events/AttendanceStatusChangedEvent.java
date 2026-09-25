package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published when a reviewer changes an employee-day's attendance: sets a status,
 * excuses the day, removes a manual status, or rejects / confirms a face punch.
 * Delivered to the employee as ATTENDANCE_STATUS_CHANGED.
 *
 * @param kind       SET, EXCUSE, CLEAR, FACE_REJECT or FACE_CONFIRM
 * @param fromStatus / toStatus effective statuses (PRESENT, LATE, HALF_DAY,
 *                   ABSENT, NOT_MARKED …) before and after the change
 * @param changedBy  the reviewer's name, for the message
 */
public record AttendanceStatusChangedEvent(
        UUID tenantId,
        UUID employeeId,
        LocalDate date,
        String kind,
        String fromStatus,
        String toStatus,
        String reason,
        String changedBy
) {}
