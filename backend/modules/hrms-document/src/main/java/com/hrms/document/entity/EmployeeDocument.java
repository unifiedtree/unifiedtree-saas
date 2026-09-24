package com.hrms.document.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.document.enums.DocumentCategory;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
// Unique JPA entity name — the simple class name "EmployeeDocument" already
// belongs to com.hrms.employee.entity.EmployeeDocument (schema hrms), and both
// packages are scanned in the canonical profile. Without a distinct entity name
// Hibernate throws DuplicateMappingException at startup. The class name + table
// (document_mgmt.employee_documents) are unchanged, so repos/services are unaffected.
@Entity(name = "VaultEmployeeDocument")
@Table(
        schema = "document_mgmt",
        name = "employee_documents"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class EmployeeDocument extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "title", nullable = false, length = 300)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 50)
    private DocumentCategory category = DocumentCategory.OTHER;

    @Column(name = "file_url", nullable = false, columnDefinition = "TEXT")
    private String fileUrl;

    @Column(name = "issued_date")
    private LocalDate issuedDate;

    @Column(name = "expiry_date")
    private LocalDate expiryDate;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    // ── V143.7 typed documents + verification workflow ──────────────────────
    @Column(name = "document_type_id")
    private UUID documentTypeId;

    @Column(name = "verification_status", length = 20, nullable = false)
    private String verificationStatus = "PENDING";

    @Column(name = "verified_by")
    private UUID verifiedBy;

    @Column(name = "verified_at")
    private java.time.Instant verifiedAt;

    @Column(name = "rejection_reason", columnDefinition = "TEXT")
    private String rejectionReason;

    @Column(name = "original_filename", length = 300)
    private String originalFilename;

    @Column(name = "file_size_bytes")
    private Long fileSizeBytes;

    @Column(name = "content_type", length = 100)
    private String contentType;
}
