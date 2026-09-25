package com.hrms.policy.dto;

import com.hrms.policy.enums.PolicyStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record PolicyResponse(
        UUID id,
        UUID companyId,
        String title,
        String category,
        String content,
        String version,
        LocalDate effectiveDate,
        PolicyStatus status,
        // Server-computed: how many employees have acknowledged this policy.
        long acknowledgementCount,
        Instant createdAt,
        /** V143.23: false = for reading only, nobody is asked to acknowledge it. */
        boolean acknowledgementRequired,
        /** V143.23: everyone is emailed when it is published. */
        boolean notifyOnPublish,
        /** V143.23: one automatic reminder this many days after publishing; null = off. */
        Integer autoRemindAfterDays,
        /** V143.23: when it last went live. */
        Instant publishedAt
) {
    /** The pre-V143.23 shape (acknowledgement required, no email, no automatic reminder). */
    public PolicyResponse(UUID id, UUID companyId, String title, String category, String content, String version,
                          LocalDate effectiveDate, PolicyStatus status, long acknowledgementCount, Instant createdAt) {
        this(id, companyId, title, category, content, version, effectiveDate, status, acknowledgementCount, createdAt,
                true, false, null, null);
    }
}
