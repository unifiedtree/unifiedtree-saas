package com.unifiedtree.auth.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Long-lived refresh token. Stored hashed; the plaintext is returned once
 * in the login response and never again. Replace-on-use semantics: every
 * refresh issues a NEW token and revokes the old one.
 */
@Entity
@Table(schema = "auth", name = "refresh_tokens")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
@Getter
@Setter
public class RefreshToken extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, length = 255)
    private String tokenHash;

    @Column(name = "device_fingerprint", length = 255)
    private String deviceFingerprint;

    @Column(name = "user_agent", length = 255)
    private String userAgent;

    @Column(name = "issued_at", nullable = false)
    private OffsetDateTime issuedAt;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "revoked_at")
    private OffsetDateTime revokedAt;

    /**
     * Stable id of the signed-in session (V143.26). Refresh rotates the row, so
     * the row id changes on every refresh; session_id is carried across
     * rotations and is the "sid" claim in the access token. Null only on rows
     * written before V143.26 (then the row id stands in for it).
     */
    @Column(name = "session_id")
    private UUID sessionId;

    /** When the person signed in (first row of the session). */
    @Column(name = "session_started_at")
    private OffsetDateTime sessionStartedAt;

    /** Last request seen on this session (touched at most once a minute). */
    @Column(name = "last_used_at")
    private OffsetDateTime lastUsedAt;

    @Column(name = "ip_address", length = 64)
    private String ipAddress;
}
