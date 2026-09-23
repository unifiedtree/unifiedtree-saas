package com.hrms.hiring.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.hiring.enums.OfferStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "hiring_mgmt", name = "offers")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class HiringOffer extends BaseEntity {
    @Column(name = "requisition_id") private UUID requisitionId;
    @Column(name = "candidate_id") private UUID candidateId;
    @Column(name = "company_id", nullable = false) private UUID companyId;
    @Column(name = "candidate_name", nullable = false, length = 200) private String candidateName;
    @Column(name = "role_title", nullable = false, length = 200) private String roleTitle;
    @Column(name = "offered_ctc", nullable = false) private BigDecimal offeredCtc = BigDecimal.ZERO;
    @Column(name = "joining_date") private LocalDate joiningDate;
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30) private OfferStatus status = OfferStatus.DRAFT;
    @Column(name = "sent_at") private Instant sentAt;
    @Column(name = "responded_at") private Instant respondedAt;
    @Column(name = "notes", columnDefinition = "TEXT") private String notes;
    @Column(name = "offer_terms", columnDefinition = "TEXT") private String offerTerms;
    @Column(name = "email_submitted_at") private Instant emailSubmittedAt;
    @Column(name = "email_recipient", length = 254) private String emailRecipient;
}
