package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * PII-sensitive bank account. account_number stored encrypted (AES-256-GCM).
 * account_number_last4 stored plain for display.
 * Access requires hrms.employee.bank.read permission.
 */
@Entity
@Table(schema = "hrms", name = "employee_bank_accounts")
@Getter
@Setter
public class EmployeeBankAccount extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "account_number_encrypted", nullable = false, columnDefinition = "TEXT")
    private String accountNumberEncrypted;

    @Column(name = "account_number_last4", nullable = false, length = 4)
    private String accountNumberLast4;

    @Column(name = "ifsc_code", nullable = false, length = 15)
    private String ifscCode;

    @Column(name = "bank_name", length = 100)
    private String bankName;

    @Column(name = "branch_name", length = 100)
    private String branchName;

    @Column(name = "account_holder_name", nullable = false, length = 150)
    private String accountHolderName;

    @Column(name = "is_primary", nullable = false)
    private boolean primary = true;

    @Column(name = "is_verified", nullable = false)
    private boolean verified = false;
}
