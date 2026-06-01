package com.hrms.auth.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.core.enums.Role;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "user_credentials",
       uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "email"}))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class UserCredential extends BaseEntity {

    @Column(nullable = false)
    private String email;

    @Column(name = "mobile_number", length = 20)
    private String mobileNumber;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "employee_id")
    private UUID employeeId;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_roles",
                     joinColumns = @JoinColumn(name = "user_credential_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "role")
    private List<Role> roles;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "is_mfa_enabled", nullable = false)
    private boolean mfaEnabled = false;

    @Column(name = "is_biometric_enabled", nullable = false)
    private boolean biometricEnabled = false;

    @Column(name = "mfa_secret")
    private String mfaSecret;

    @Column(name = "failed_login_attempts", nullable = false)
    private int failedLoginAttempts = 0;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @Column(name = "password_changed_at")
    private Instant passwordChangedAt;

    public boolean isLocked() {
        return lockedUntil != null && Instant.now().isBefore(lockedUntil);
    }
}
