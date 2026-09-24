package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * An employee uploaded a document that is now pending HR verification. HR
 * (and admins holding hrms.document.verify) get a bell + push notification so
 * the review queue doesn't sit unread.
 */
public record DocumentUploadedEvent(
        UUID documentId,
        UUID employeeId,
        UUID tenantId,
        String documentTypeCode,
        String documentTypeName,
        String title
) {}
