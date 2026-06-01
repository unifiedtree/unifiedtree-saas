package com.unifiedtree.rbac.repository;

import com.unifiedtree.rbac.entity.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface RoleRepository extends JpaRepository<Role, UUID> {

    /**
     * Find a role by code, considering both system roles (tenant_id IS NULL)
     * and the current tenant's custom roles. RLS handles tenant scope for
     * the latter; the system rows are visible because the RLS policy
     * allows tenant_id IS NULL.
     */
    Optional<Role> findByCode(String code);

    /** List system roles regardless of tenant context. */
    @Query("SELECT r FROM Role r WHERE r.tenantId IS NULL ORDER BY r.code")
    List<Role> findSystemRoles();

    /** List roles visible in current tenant context (system + own). */
    List<Role> findAllByOrderByCodeAsc();

    /** Check if a tenant already has a role with this code (for duplicate prevention). */
    boolean existsByTenantIdAndCode(UUID tenantId, String code);
}
