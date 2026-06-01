package com.unifiedtree.rbac.repository;

import com.unifiedtree.rbac.entity.UserRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface UserRoleRepository extends JpaRepository<UserRole, UserRole.PK> {
    /** All role grants for a user inside the current tenant. RLS handles tenant scope. */
    List<UserRole> findAllByUserId(UUID userId);

    /** All user grants for a specific role (used for cache eviction on role permission change). */
    List<UserRole> findAllByRoleId(UUID roleId);
}
