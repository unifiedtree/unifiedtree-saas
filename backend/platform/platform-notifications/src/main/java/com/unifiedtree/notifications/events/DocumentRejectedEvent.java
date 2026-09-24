package com.unifiedtree.notifications.events;

import java.util.UUID;

/** HR rejected an employee's uploaded document with a reason. Employee is notified to re-upload. */
public record DocumentRejectedEvent(
        UUID documentId,
        UUID employeeId,
        UUID tenantId,
        String documentTypeName,
        String title,
        String reason
) {}
