package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by {@code AttendanceService.createCorrectionRequest}. Unlike leave /
 * WFH, an attendance correction stores no approver up front, so the listener
 * resolves the recipient at fan-out time using the same chain the approvals
 * queue relies on: reporting manager → department head → terminal HR/admin.
 */
public record CorrectionSubmittedEvent(
        UUID correctionId,
        UUID employeeId,
        UUID tenantId,
        LocalDate requestedDate
) {}
