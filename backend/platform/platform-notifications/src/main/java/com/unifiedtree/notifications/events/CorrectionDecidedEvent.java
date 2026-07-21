package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by {@code AttendanceService.decideCorrection} after a terminal
 * APPROVED / REJECTED decision. {@code approved} = true → CORRECTION_APPROVED,
 * false → CORRECTION_REJECTED, delivered to the requesting employee.
 */
public record CorrectionDecidedEvent(
        UUID correctionId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        LocalDate requestedDate,
        String comment
) {}
