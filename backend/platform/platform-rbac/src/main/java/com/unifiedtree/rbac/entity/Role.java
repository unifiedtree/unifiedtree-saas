package com.unifiedtree.rbac.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.UUID;

/**
 * Role catalog row.
 * - System role (tenant_id IS NULL, is_system = true) ships with the platform
 *   (SUPER_ADMIN, HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER, EMPLOYEE).
 * - Tenant-custom role (tenant_id NOT NULL) is created by the tenant admin.
 *
 * RLS policy: USING (tenant_id IS NULL OR tenant_id = current_tenant_id()).
 *
 * Not extending BaseEntity because the v1 schema (V004) for rbac.roles
 * intentionally lacks updated_at / created_by / updated_by / version.
 * Roles are nearly-immutable catalog data; the simpler shape is correct.
 */
@Entity
@Table(schema = "rbac", name = "roles")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
public class Role {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    /** Nullable: system roles have no tenant. */
    @Column(name = "tenant_id", updatable = false)
    private UUID tenantId;

    @Column(name = "code", nullable = false, length = 50)
    private String code;

    @Column(name = "display_name", nullable = false, length = 100)
    private String displayName;

    @Column(name = "description")
    private String description;

    @Column(name = "is_system", nullable = false)
    private boolean systemRole;

    @Column(name = "is_default_for_new_users", nullable = false)
    private boolean defaultForNewUsers;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
