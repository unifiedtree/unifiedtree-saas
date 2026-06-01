package com.unifiedtree.rbac.repository;

import com.unifiedtree.rbac.entity.RolePermission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface RolePermissionRepository
        extends JpaRepository<RolePermission, RolePermission.PK> {

    List<RolePermission> findAllByRoleId(UUID roleId);

    /** Get every permission code granted to any of the given roles (de-dup at SQL level). */
    @Query("SELECT DISTINCT rp.permissionCode FROM RolePermission rp WHERE rp.roleId IN :roleIds")
    List<String> findPermissionCodesByRoleIds(@Param("roleIds") Collection<UUID> roleIds);
}
