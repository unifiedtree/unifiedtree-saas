package com.hrms.compliance.entity;

import com.hrms.compliance.enums.InspectorSessionStatus;
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
@Table(schema = "compliance_mgmt", name = "inspector_sessions")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class InspectorSession extends BaseEntity {
    @Column(name = "company_id", nullable = false) private UUID companyId;
    @Column(name = "inspector_name", nullable = false, length = 200) private String inspectorName;
    @Column(name = "inspector_org", length = 200) private String inspectorOrg;
    @Column(name = "purpose", nullable = false, length = 200) private String purpose;
    @Column(name = "access_code", nullable = false, length = 24) private String accessCode;
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30) private InspectorSessionStatus status = InspectorSessionStatus.ACTIVE;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(name = "last_accessed_at") private Instant lastAccessedAt;
    @Column(name = "revoked_at") private Instant revokedAt;
    @Column(name = "notes", columnDefinition = "TEXT") private String notes;
}
