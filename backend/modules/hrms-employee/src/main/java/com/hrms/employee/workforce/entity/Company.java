package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/**
 * Canonical company record in {@code org.companies}. A tenant can host
 * multiple companies (group structure). RLS-isolated by tenant_id.
 */
@Entity
@Table(schema = "org", name = "companies")
@Getter
@Setter
public class Company extends BaseEntity {

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "legal_name", length = 200)
    private String legalName;

    @Column(name = "registration_number", length = 50)
    private String registrationNumber;

    @Column(name = "pan_number", length = 15)
    private String panNumber;

    @Column(name = "gstin", length = 20)
    private String gstin;

    @Column(name = "industry", length = 50)
    private String industry;

    @Column(name = "country", length = 50)
    private String country;

    @Column(name = "timezone", length = 50)
    private String timezone;

    @Column(name = "currency", length = 10)
    private String currency;

    @Column(name = "fiscal_year_start", length = 10)
    private String fiscalYearStart;

    @Column(name = "logo_url", length = 500)
    private String logoUrl;

    @Column(name = "employee_count_cached")
    private Integer employeeCountCached;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
