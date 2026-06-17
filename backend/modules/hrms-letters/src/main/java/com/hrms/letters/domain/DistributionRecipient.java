package com.hrms.letters.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One recipient row of a {@link DistributionJob}. The email is snapshotted at
 * creation time so a later employee change does not alter a past distribution.
 */
@Entity
@Table(schema = "letters", name = "distribution_recipients")
@Getter
@Setter
public class DistributionRecipient {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "job_id", nullable = false)
    private UUID jobId;

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "generated_letter_id")
    private UUID generatedLetterId;

    @Column(name = "email", nullable = false, length = 320)
    private String email;

    /** PENDING | GENERATING | SENT | FAILED | SKIPPED */
    @Column(name = "send_status", nullable = false, length = 20)
    private String sendStatus = "PENDING";

    @Column(name = "send_attempted_at")
    private Instant sendAttemptedAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;
}
