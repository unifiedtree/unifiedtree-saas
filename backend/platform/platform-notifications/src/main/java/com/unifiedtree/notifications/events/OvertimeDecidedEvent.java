package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by {@code OvertimeController} approve/reject. The requesting
 * employee is notified. Overtime is auto-created from attendance; there is no
 * "submitted" event.
 */
public record OvertimeDecidedEvent(
        UUID overtimeId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        LocalDate onDate,
        int minutes,
        String comment
) {}
