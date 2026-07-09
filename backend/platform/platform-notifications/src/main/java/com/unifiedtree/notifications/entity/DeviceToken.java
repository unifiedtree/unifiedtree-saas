package com.unifiedtree.notifications.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Expo push token per (user, device). One row per (user_id, expo_push_token).
 * Tenant isolation by RLS on {@code tenant_isolation_device_tokens}.
 */
@Entity
@Table(schema = "notif", name = "device_tokens")
@Getter
@Setter
public class DeviceToken {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "expo_push_token", nullable = false, columnDefinition = "TEXT")
    private String expoPushToken;

    @Column(name = "platform", length = 20)
    private String platform;

    @Column(name = "device_name", length = 120)
    private String deviceName;

    @Column(name = "app_version", length = 30)
    private String appVersion;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "last_used_at", nullable = false)
    private Instant lastUsedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (lastUsedAt == null) lastUsedAt = now;
    }
}
