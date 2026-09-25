package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published by the payroll bulk salary revision for every person whose salary
 * structure it revised. Consumed AFTER_COMMIT: the employee is told their
 * salary changes from {@code effectiveFrom} (no amounts in the message, since
 * push notifications show on lock screens).
 */
public record SalaryStructureRevisedEvent(
        UUID tenantId,
        UUID employeeId,
        UUID structureId,
        LocalDate effectiveFrom
) {}
