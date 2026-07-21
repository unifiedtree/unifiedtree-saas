package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by {@code WfhService.decide} after a terminal APPROVED / REJECTED
 * decision is persisted. {@code approved} = true → WFH_APPROVED, false →
 * WFH_REJECTED, delivered to the requesting employee.
 */
public record WfhDecidedEvent(
        UUID wfhRequestId,
        UUID employeeId,
        UUID tenantId,
        boolean approved,
        LocalDate fromDate,
        LocalDate toDate,
        String comment
) {}
