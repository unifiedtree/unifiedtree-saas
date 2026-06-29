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
@Entity
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
}
