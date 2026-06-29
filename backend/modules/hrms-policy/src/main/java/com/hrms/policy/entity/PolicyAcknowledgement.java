package com.hrms.policy.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "policy_mgmt",
        name = "policy_acknowledgements"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class PolicyAcknowledgement extends BaseEntity {

    @Column(name = "policy_id", nullable = false)
    private UUID policyId;

    @Column(name = "employee_id")
    private UUID employeeId;

    // Stamped server-side when the employee acknowledges.
    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;
}
