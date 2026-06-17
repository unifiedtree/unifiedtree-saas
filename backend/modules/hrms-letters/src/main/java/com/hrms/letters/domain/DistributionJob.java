package com.hrms.letters.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A bulk letter-distribution job. Standalone entity (NOT BaseEntity) because the
 * lean V058 table omits version/updated_* columns; tenant_id and created_by are
 * set explicitly by the service at creation time (request thread, so RLS
 * WITH CHECK on app.tenant_id passes).
 */
@Entity
@Table(schema = "letters", name = "distribution_jobs")
@Getter
@Setter
public class DistributionJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "template_id", nullable = false)
    private UUID templateId;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "custom_message", columnDefinition = "TEXT")
    private String customMessage;

    @Column(name = "subject_override", length = 500)
    private String subjectOverride;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    /** PENDING | PROCESSING | COMPLETED | PARTIAL_FAILURE | FAILED */
    @Column(name = "status", nullable = false, length = 20)
    private String status = "PENDING";

    @Column(name = "total_recipients", nullable = false)
    private int totalRecipients = 0;

    @Column(name = "sent_count", nullable = false)
    private int sentCount = 0;

    @Column(name = "failed_count", nullable = false)
    private int failedCount = 0;

    @Column(name = "completed_at")
    private Instant completedAt;
}
