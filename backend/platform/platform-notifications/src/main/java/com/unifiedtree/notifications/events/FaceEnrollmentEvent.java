package com.unifiedtree.notifications.events;

import java.util.UUID;

/**
 * Published by the face module after enrollment reaches a terminal state.
 *
 * <p>{@code success = true} → enrollment completed (all samples captured and
 *   templates persisted). Handler produces FACE_ENROLLMENT_COMPLETE for the
 *   employee.
 * <p>{@code success = false} → enrollment locked / abandoned. Handler produces
 *   FACE_ENROLLMENT_FAILED so the employee knows to ask their manager to reset.
 */
public record FaceEnrollmentEvent(
        UUID tenantId,
        UUID employeeId,
        boolean success,
        String reason
) {}
