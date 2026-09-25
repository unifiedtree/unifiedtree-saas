package com.unifiedtree.notifications.events;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Someone reaches their company's retirement age soon (HR Configuration →
 * retirement age). Published by the daily retirement alert job 90 days and
 * again 30 days before the date; everyone in {@code recipientEmployeeIds}
 * (people holding hrms.retirement.alerts) gets a bell + push notification.
 *
 * <p>The producer resolves every name and recipient while its tenant-bound
 * transaction is live, so the AFTER_COMMIT handler needs no database reads.
 */
public record RetirementDueEvent(
        UUID tenantId,
        UUID employeeId,
        String employeeName,
        String department,
        LocalDate retirementDate,
        int retirementAge,
        long daysLeft,
        List<UUID> recipientEmployeeIds
) {}
