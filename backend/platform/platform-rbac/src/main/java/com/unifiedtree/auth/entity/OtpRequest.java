package com.unifiedtree.auth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * OTP request row backing V104__otp_requests.sql — the server-owned
 * one-time-password ledger for the MSG91 phone-auth login flow.
 *
 * <p>Deliberately does NOT extend {@code BaseEntity} — that class carries a
 * mandatory {@code tenant_id} column and the audit/version columns of a
 * per-tenant table. {@code auth.otp_requests} is platform-scoped: the
 * phone→tenant mapping is unknown at /request time and is resolved at
 * /verify time by {@link com.unifiedtree.auth.phone.PhoneLookupService}.
 *
 * <p>Never stores the plaintext OTP. {@link #otpHash} is a BCrypt hash of
 * the 6-digit code we generated + sent through MSG91.
 *
 * <p>Package placement: kept in {@code com.unifiedtree.auth.entity} so the
 * canonical-profile {@code @EntityScan} allow-list picks it up without any
 * change to {@code CanonicalProfileScan} (see memory note
 * "Canonical component scan is an allow-list").
 */
@Entity
@Table(schema = "auth", name = "otp_requests")
public class OtpRequest {

    public static final String STATUS_SENT     = "SENT";
    public static final String STATUS_VERIFIED = "VERIFIED";
    public static final String STATUS_EXPIRED  = "EXPIRED";
    public static final String STATUS_REVOKED  = "REVOKED";
    public static final String STATUS_LOCKED   = "LOCKED";

    public static final String PURPOSE_LOGIN          = "LOGIN";
    public static final String PURPOSE_REGISTER       = "REGISTER";
    public static final String PURPOSE_PASSWORD_RESET = "PASSWORD_RESET";

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    /** Last 10 digits of the E.164 number — the RLS-friendly join key. */
    @Column(name = "phone_last10", nullable = false, length = 10)
    private String phoneLast10;

    /** Full E.164 number as sent to MSG91 (e.g. {@code +919876543210}). */
    @Column(name = "phone_e164", nullable = false, length = 16)
    private String phoneE164;

    /** BCrypt hash of the 6-digit OTP. */
    @Column(name = "otp_hash", nullable = false)
    private String otpHash;

    @Column(name = "purpose", nullable = false, length = 32)
    private String purpose = PURPOSE_LOGIN;

    @Column(name = "provider", nullable = false, length = 16)
    private String provider = "msg91";

    /** {@code request_id} returned by MSG91 POST /api/v5/otp — may be null on send failure. */
    @Column(name = "msg91_request_id")
    private String msg91RequestId;

    @Column(name = "correlation_id", nullable = false)
    private UUID correlationId;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "sent_at", nullable = false)
    private OffsetDateTime sentAt;

    @Column(name = "verified_at")
    private OffsetDateTime verifiedAt;

    @Column(name = "revoked_at")
    private OffsetDateTime revokedAt;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "max_attempts", nullable = false)
    private int maxAttempts = 5;

    @Column(name = "status", nullable = false, length = 20)
    private String status = STATUS_SENT;

    @Column(name = "request_ip", length = 64)
    private String requestIp;

    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void assignDefaults() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = OffsetDateTime.now();
        if (sentAt == null) sentAt = createdAt;
        if (correlationId == null) correlationId = UUID.randomUUID();
    }

    // ── getters + setters ─────────────────────────────────────────────────────

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public String getPhoneLast10() { return phoneLast10; }
    public void setPhoneLast10(String phoneLast10) { this.phoneLast10 = phoneLast10; }

    public String getPhoneE164() { return phoneE164; }
    public void setPhoneE164(String phoneE164) { this.phoneE164 = phoneE164; }

    public String getOtpHash() { return otpHash; }
    public void setOtpHash(String otpHash) { this.otpHash = otpHash; }

    public String getPurpose() { return purpose; }
    public void setPurpose(String purpose) { this.purpose = purpose; }

    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }

    public String getMsg91RequestId() { return msg91RequestId; }
    public void setMsg91RequestId(String msg91RequestId) { this.msg91RequestId = msg91RequestId; }

    public UUID getCorrelationId() { return correlationId; }
    public void setCorrelationId(UUID correlationId) { this.correlationId = correlationId; }

    public OffsetDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(OffsetDateTime expiresAt) { this.expiresAt = expiresAt; }

    public OffsetDateTime getSentAt() { return sentAt; }
    public void setSentAt(OffsetDateTime sentAt) { this.sentAt = sentAt; }

    public OffsetDateTime getVerifiedAt() { return verifiedAt; }
    public void setVerifiedAt(OffsetDateTime verifiedAt) { this.verifiedAt = verifiedAt; }

    public OffsetDateTime getRevokedAt() { return revokedAt; }
    public void setRevokedAt(OffsetDateTime revokedAt) { this.revokedAt = revokedAt; }

    public int getAttempts() { return attempts; }
    public void setAttempts(int attempts) { this.attempts = attempts; }

    public int getMaxAttempts() { return maxAttempts; }
    public void setMaxAttempts(int maxAttempts) { this.maxAttempts = maxAttempts; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getRequestIp() { return requestIp; }
    public void setRequestIp(String requestIp) { this.requestIp = requestIp; }

    public String getUserAgent() { return userAgent; }
    public void setUserAgent(String userAgent) { this.userAgent = userAgent; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }
}
