package com.unifiedtree.rbac.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * Join row between {@link Role} and {@link Permission}.
 * Composite primary key (role_id, permission_code).
 *
 * RLS policy lets the row through if the owning role is visible (system
 * role or matches current_tenant_id).
 */
@Entity
@Table(schema = "rbac", name = "role_permissions")
@IdClass(RolePermission.PK.class)
@Getter
@Setter
public class RolePermission {

    @Id
    @Column(name = "role_id", nullable = false)
    private UUID roleId;

    @Id
    @Column(name = "permission_code", length = 100, nullable = false)
    private String permissionCode;

    public RolePermission() {}

    public RolePermission(UUID roleId, String permissionCode) {
        this.roleId = roleId;
        this.permissionCode = permissionCode;
    }

    public static class PK implements Serializable {
        private UUID roleId;
        private String permissionCode;

        public PK() {}
        public PK(UUID roleId, String permissionCode) {
            this.roleId = roleId;
            this.permissionCode = permissionCode;
        }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof PK pk)) return false;
            return Objects.equals(roleId, pk.roleId)
                && Objects.equals(permissionCode, pk.permissionCode);
        }
        @Override public int hashCode() { return Objects.hash(roleId, permissionCode); }
    }
}
