package com.unifiedtree.rbac.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.io.Serializable;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;

/**
 * Grant of a role to a user, scoped to a tenant. Composite primary key
 * (tenant_id, user_id, role_id) so the same user could in theory hold a
 * different set of roles across tenants -- though today every credential
 * lives in exactly one tenant.
 *
 * RLS policy: USING (tenant_id = current_tenant_id()).
 */
@Entity
@Table(schema = "rbac", name = "user_roles")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
@IdClass(UserRole.PK.class)
@Getter
@Setter
public class UserRole {

    @Id
    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Id
    @Column(name = "role_id", nullable = false)
    private UUID roleId;

    @Column(name = "granted_at", nullable = false)
    private OffsetDateTime grantedAt;

    @Column(name = "granted_by")
    private UUID grantedBy;

    public UserRole() {}

    public UserRole(UUID tenantId, UUID userId, UUID roleId) {
        this.tenantId = tenantId;
        this.userId = userId;
        this.roleId = roleId;
        this.grantedAt = OffsetDateTime.now();
    }

    public static class PK implements Serializable {
        private UUID tenantId;
        private UUID userId;
        private UUID roleId;

        public PK() {}
        public PK(UUID tenantId, UUID userId, UUID roleId) {
            this.tenantId = tenantId; this.userId = userId; this.roleId = roleId;
        }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof PK pk)) return false;
            return Objects.equals(tenantId, pk.tenantId)
                && Objects.equals(userId, pk.userId)
                && Objects.equals(roleId, pk.roleId);
        }
        @Override public int hashCode() { return Objects.hash(tenantId, userId, roleId); }
    }
}
