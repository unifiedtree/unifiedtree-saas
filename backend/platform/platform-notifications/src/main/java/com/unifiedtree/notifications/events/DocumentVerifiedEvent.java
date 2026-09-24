package com.unifiedtree.notifications.events;

import java.util.UUID;

/** HR verified an employee's uploaded document. Employee gets a confirmation notification. */
public record DocumentVerifiedEvent(
        UUID documentId,
        UUID employeeId,
        UUID tenantId,
        String documentTypeName,
        String title
) {}
