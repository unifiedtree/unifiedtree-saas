package com.hrms.tenant.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.tenant.enums.SubscriptionTier;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
    name = "companies",
    uniqueConstraints = @UniqueConstraint(
        name = "uq_companies_tenant_domain",
        columnNames = {"tenant_id", "domain"}
    )
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Company extends BaseEntity {

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "domain")
    private String domain;

    @Column(name = "logo_url")
    private String logoUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "subscription_tier", length = 50)
    private SubscriptionTier subscriptionTier;

    @Column(name = "max_employees")
    private int maxEmployees;

    @Column(name = "industry")
    private String industry;

    @Column(name = "country")
    private String country;

    @Column(name = "timezone")
    private String timezone;

    @Column(name = "currency", columnDefinition = "VARCHAR(10) DEFAULT 'INR'")
    private String currency = "INR";

    @Column(name = "is_active", columnDefinition = "BOOLEAN DEFAULT true")
    private boolean isActive = true;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings", columnDefinition = "jsonb")
    private Map<String, Object> settings;
}
