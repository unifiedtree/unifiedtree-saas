package com.unifiedtree.notifications.events;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Published by {@code LeaveEncashmentService.decide} on APPROVED / REJECTED.
 * The employee is told; an approval says it is paid in the next payroll run.
 */
public record LeaveEncashmentDecidedEvent(
        UUID requestId,
        UUID employeeId,
        UUID tenantId,
        String leaveTypeName,
        double days,
        boolean approved,
        String note,
        BigDecimal amount
) {}
