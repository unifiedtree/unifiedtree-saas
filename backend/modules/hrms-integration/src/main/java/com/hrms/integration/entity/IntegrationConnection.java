package com.hrms.integration.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.integration.enums.IntegrationStatus;
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
        schema = "integration_mgmt",
        name = "integration_connections"
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class IntegrationConnection extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    // Vendor / provider identifier (e.g. "Slack", "Razorpay", "Google Workspace").
    @Column(name = "provider", nullable = false, length = 80)
    private String provider;

    // Functional grouping (e.g. "Communication", "Payroll", "Identity").
    @Column(name = "category", length = 50)
    private String category;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private IntegrationStatus status = IntegrationStatus.DISCONNECTED;

    @Column(name = "config_summary", columnDefinition = "TEXT")
    private String configSummary;

    // Last time a successful sync/handshake completed; set when connecting.
    @Column(name = "last_synced_at")
    private Instant lastSyncedAt;
}
