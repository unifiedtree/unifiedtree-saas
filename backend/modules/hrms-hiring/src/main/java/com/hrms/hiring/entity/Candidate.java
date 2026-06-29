package com.hrms.hiring.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.hiring.enums.CandidateStage;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.math.BigDecimal;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "hiring_mgmt",
        name = "candidates"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Candidate extends BaseEntity {

    // Parent requisition (→ job_requisitions.id). Cascades delete with the requisition at the DB level.
    @Column(name = "requisition_id", nullable = false)
    private UUID requisitionId;

    @Column(name = "full_name", nullable = false, length = 200)
    private String fullName;

    @Column(name = "email", length = 200)
    private String email;

    @Column(name = "phone", length = 40)
    private String phone;

    @Enumerated(EnumType.STRING)
    @Column(name = "stage", nullable = false, length = 30)
    private CandidateStage stage = CandidateStage.APPLIED;

    @Column(name = "source", length = 80)
    private String source;

    @Column(name = "expected_ctc")
    private BigDecimal expectedCtc;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;
}
