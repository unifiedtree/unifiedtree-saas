package com.hrms.auth.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.Instant;

@Getter
@Setter
@Entity
@Table(name = "auth_otp_challenges")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class OtpChallenge extends BaseEntity {

    @Column(name = "mobile_number", nullable = false, length = 20)
    private String mobileNumber;

    @Column(name = "code_hash", nullable = false, length = 512)
    private String codeHash;

    @Column(name = "purpose", nullable = false, length = 50)
    private String purpose = "LOGIN";

    @Column(name = "attempts", nullable = false)
    private int attempts = 0;

    @Column(name = "max_attempts", nullable = false)
    private int maxAttempts = 3;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "device_fingerprint")
    private String deviceFingerprint;

    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }

    public boolean isConsumed() {
        return consumedAt != null;
    }
}
