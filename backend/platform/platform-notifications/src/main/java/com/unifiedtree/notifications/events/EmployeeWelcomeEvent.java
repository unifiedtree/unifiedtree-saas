package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * Published by {@code InvitationService.acceptInvitation} once a newly-invited
 * employee sets their password and activates. Produces a WELCOME notification
 * the employee sees the first time they open the app.
 */
public record EmployeeWelcomeEvent(
        UUID tenantId,
        UUID employeeId,
        String tenantName
) {}
