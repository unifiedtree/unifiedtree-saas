package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.util.UUID;

/**
 * PII-sensitive identity document data. All encrypted fields are AES-256-GCM
 * encrypted at the application layer before persistence. Only aadhaar_last4
 * is stored in plain text for display purposes.
 * Access requires hrms.employee.identity.read permission.
 */
@Entity
@Table(schema = "hrms", name = "employee_identities")
@Getter
@Setter
public class EmployeeIdentity extends BaseEntity {

    @Column(name = "employee_id", nullable = false, unique = true)
    private UUID employeeId;

    @Column(name = "pan_encrypted", columnDefinition = "TEXT")
    private String panEncrypted;

    @Column(name = "aadhaar_last4", length = 4)
    private String aadhaarLast4;

    @Column(name = "aadhaar_encrypted", columnDefinition = "TEXT")
    private String aadhaarEncrypted;

    @Column(name = "uan", length = 30)
    private String uan;

    @Column(name = "esic_number", length = 30)
    private String esicNumber;

    @Column(name = "passport_number_encrypted", columnDefinition = "TEXT")
    private String passportNumberEncrypted;

    @Column(name = "passport_expiry")
    private LocalDate passportExpiry;
}
