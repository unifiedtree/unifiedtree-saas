package com.unifiedtree.rbac.repository;

import com.unifiedtree.rbac.entity.Permission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PermissionRepository extends JpaRepository<Permission, String> {
    List<Permission> findAllByModuleOrderByCodeAsc(String module);
    List<Permission> findAllByOrderByCodeAsc();
}
