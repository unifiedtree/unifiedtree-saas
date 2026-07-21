package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by {@code WfhService.cancel} when an employee cancels their own
 * PENDING/APPROVED WFH request. The approver is notified (WFH_CANCELLED) so a
 * stale request never lingers in their approvals queue.
 */
public record WfhCancelledEvent(
        UUID wfhRequestId,
        UUID employeeId,
        UUID approverId,
        UUID tenantId,
        LocalDate fromDate,
        LocalDate toDate
) {}
