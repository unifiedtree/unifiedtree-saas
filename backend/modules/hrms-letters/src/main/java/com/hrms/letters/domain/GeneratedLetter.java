package com.hrms.letters.domain;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(schema = "letters", name = "generated")
@Getter
@Setter
public class GeneratedLetter extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "template_id", nullable = false)
    private UUID templateId;

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "type", nullable = false, length = 40)
    private String type;

    @Column(name = "subject", nullable = false, length = 500)
    private String subject;

    @Column(name = "body_html_rendered", nullable = false, columnDefinition = "TEXT")
    private String bodyHtmlRendered;

    @Column(name = "pdf_path", length = 1000)
    private String pdfPath;

    @Column(name = "pdf_size_bytes")
    private Long pdfSizeBytes;

    @Column(name = "status", nullable = false, length = 20)
    private String status = "GENERATED";

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "sent_to_email", length = 320)
    private String sentToEmail;

    @Column(name = "viewed_at")
    private Instant viewedAt;

    @Column(name = "signed_at")
    private Instant signedAt;

    @Column(name = "voided_at")
    private Instant voidedAt;

    @Column(name = "voided_reason", length = 500)
    private String voidedReason;

    @Column(name = "generated_by", nullable = false)
    private UUID generatedBy;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "generation_context", columnDefinition = "JSONB")
    private Map<String, String> generationContext;

    @Column(name = "deleted_at")
    private Instant deletedAt;
}
