package com.unifiedtree.notifications.events;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * An interview was scheduled, changed or cancelled; the listed interviewers
 * (employee ids) are told. Everything the message needs travels on the event,
 * so the AFTER_COMMIT handler never has to read tenant tables.
 *
 * @param kind SCHEDULED (newly on the interview), RESCHEDULED (time, place or
 *             mode changed), CANCELLED (interview called off) or REMOVED
 *             (this interviewer was taken off it)
 */
public record InterviewNotificationEvent(
        UUID tenantId,
        UUID interviewId,
        String kind,
        List<UUID> recipientEmployeeIds,
        String candidateName,
        String roleTitle,
        String interviewTitle,
        Instant scheduledAt,
        int durationMinutes,
        String mode,
        String location
) {}
