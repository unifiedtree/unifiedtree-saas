package com.unifiedtree.auth.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Canonical user credential row. Tenant-scoped (RLS-isolated). Stores the
 * minimum identity needed to authenticate; everything else (employee record
 * with bank, address, biometric, etc.) lives in hrms.employees and is
 * linked via {@link #employeeId}.
 */
@Entity
@Table(schema = "auth", name = "user_credentials")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
@Getter
@Setter
public class UserCredentials extends BaseEntity {

    @Column(name = "email", nullable = false, length = 255)
    private String email;

    @Column(name = "mobile_number", length = 20)
    private String mobileNumber;

    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    @Column(name = "employee_id")
    private UUID employeeId;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "is_biometric_enabled", nullable = false)
    private boolean biometricEnabled;

    @Column(name = "last_login_at")
    private OffsetDateTime lastLoginAt;

    @Column(name = "failed_login_count", nullable = false)
    private int failedLoginCount;

    @Column(name = "locked_until")
    private OffsetDateTime lockedUntil;

    @Column(name = "password_updated_at")
    private OffsetDateTime passwordUpdatedAt;

    @Column(name = "invited_at")
    private OffsetDateTime invitedAt;
}
