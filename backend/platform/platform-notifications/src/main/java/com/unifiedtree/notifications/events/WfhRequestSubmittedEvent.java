package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by {@code WfhService.apply} after the {@code wfh_requests} row is
 * persisted. Consumed AFTER_COMMIT by
 * {@link com.unifiedtree.notifications.listener.DomainEventListener} which
 * produces a WFH_SUBMITTED notification for the approver.
 *
 * <p>The approver is resolved by {@code WfhController} (reporting manager →
 * department head → terminal HR/admin fallback) and passed straight through, so
 * it is always a real, active employee id — never null.
 */
public record WfhRequestSubmittedEvent(
        UUID wfhRequestId,
        UUID employeeId,
        UUID approverId,
        UUID tenantId,
        LocalDate fromDate,
        LocalDate toDate
) {}
