package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * In-process Spring event published by {@code LeaveService.applyLeave} after
 * the {@code leave_requests} row has been persisted. Consumed synchronously
 * (AFTER_COMMIT) by {@link com.unifiedtree.notifications.listener.DomainEventListener}
 * which produces a LEAVE_SUBMITTED notification for the approver.
 *
 * <p>NOT a Kafka event — Kafka is off on Railway. All fanout happens in-process.
 */
public record LeaveRequestSubmittedEvent(
        UUID leaveRequestId,
        UUID employeeId,
        UUID approverId,
        UUID tenantId,
        String leaveTypeName,
        LocalDate startDate,
        LocalDate endDate,
        double totalDays
) {}
