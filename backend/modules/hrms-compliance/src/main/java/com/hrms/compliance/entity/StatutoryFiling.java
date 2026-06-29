package com.hrms.compliance.entity;

import com.hrms.compliance.enums.FilingStatus;
import com.hrms.compliance.enums.FilingType;
import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "compliance_mgmt",
        name = "statutory_filings"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class StatutoryFiling extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Enumerated(EnumType.STRING)
    @Column(name = "filing_type", nullable = false, length = 30)
    private FilingType filingType;

    // Statutory period the filing covers (e.g. "2026-05" or "Q1-2026").
    @Column(name = "period", length = 20)
    private String period;

    @Column(name = "amount")
    private BigDecimal amount;

    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;

    // Set when the filing is recorded as filed.
    @Column(name = "filed_date")
    private LocalDate filedDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private FilingStatus status = FilingStatus.DUE;

    // Challan / acknowledgement reference returned by the statutory portal.
    @Column(name = "reference_no", length = 120)
    private String referenceNo;
}
