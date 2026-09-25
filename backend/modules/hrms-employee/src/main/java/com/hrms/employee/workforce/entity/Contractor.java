package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "contractors")
@Getter
@Setter
public class Contractor extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "agency_name", nullable = false, length = 150)
    private String agencyName;

    @Column(name = "registration_number", length = 50)
    private String registrationNumber;

    @Column(name = "gstin", length = 20)
    private String gstin;

    @Column(name = "contact_person_name", length = 100)
    private String contactPersonName;

    @Column(name = "contact_email", length = 255)
    private String contactEmail;

    @Column(name = "contact_phone", length = 20)
    private String contactPhone;

    @Column(name = "address_line", length = 255)
    private String addressLine;

    @Column(name = "city",  length = 100) private String city;
    @Column(name = "state", length = 100) private String state;

    /** Never maintained; the API counts linked workers instead (see ContractorService). */
    @Column(name = "active_workers_count")
    private Integer activeWorkersCount;

    /** CLRA licence (V143.22). */
    @Column(name = "licence_number", length = 60)
    private String licenceNumber;

    @Column(name = "licence_valid_until")
    private java.time.LocalDate licenceValidUntil;

    /** What the agency provides, e.g. "Security & front desk" (V143.22). */
    @Column(name = "service_type", length = 150)
    private String serviceType;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
