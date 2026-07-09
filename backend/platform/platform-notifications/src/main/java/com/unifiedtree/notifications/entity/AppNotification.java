package com.unifiedtree.notifications.entity;

import com.unifiedtree.notifications.enums.AppNotificationType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Recipient-scoped notification record.
 *
 * <p>Tenant isolation is enforced by the {@code tenant_isolation_notif} RLS
 * policy (V084) that keys on {@code current_tenant_id()}. User isolation is
 * enforced at the query layer inside {@link com.unifiedtree.notifications.service.AppNotificationService}
 * by always filtering {@code WHERE user_id = :jwtUserId} — this codebase has no
 * {@code current_user_id()} GUC.
 */
@Entity
@Table(schema = "notif", name = "notifications")
@Getter
@Setter
public class AppNotification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 60, updatable = false)
    private AppNotificationType type;

    @Column(name = "title", nullable = false, length = 300)
    private String title;

    @Column(name = "body", columnDefinition = "TEXT")
    private String body;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "data", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> data = new HashMap<>();

    @Column(name = "read_at")
    private Instant readAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "updated_by")
    private String updatedBy;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
        if (data == null) data = new HashMap<>();
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
