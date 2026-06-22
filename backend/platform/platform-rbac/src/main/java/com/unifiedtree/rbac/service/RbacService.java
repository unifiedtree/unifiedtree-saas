package com.unifiedtree.rbac.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.rbac.entity.Permission;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.entity.RolePermission;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.repository.PermissionRepository;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.rbac.security.PermissionCacheEvictEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class RbacService {

    private final RoleRepository roleRepo;
    private final PermissionRepository permissionRepo;
    private final RolePermissionRepository rolePermissionRepo;
    private final UserRoleRepository userRoleRepo;
    private final ApplicationEventPublisher events;

    public RbacService(RoleRepository roleRepo,
                       PermissionRepository permissionRepo,
                       RolePermissionRepository rolePermissionRepo,
                       UserRoleRepository userRoleRepo,
                       ApplicationEventPublisher events) {
        this.roleRepo = roleRepo;
        this.permissionRepo = permissionRepo;
        this.rolePermissionRepo = rolePermissionRepo;
        this.userRoleRepo = userRoleRepo;
        this.events = events;
    }

    @Transactional(readOnly = true)
    public List<Role> listVisibleRoles() {
        return roleRepo.findAllByOrderByCodeAsc();
    }

    @Transactional(readOnly = true)
    public List<Permission> listPermissions() {
        return permissionRepo.findAllByOrderByCodeAsc();
    }

    @Transactional(readOnly = true)
    public List<String> getPermissionsForRole(UUID roleId) {
        roleRepo.findById(roleId).orElseThrow(() ->
            new ResourceNotFoundException("Role " + roleId + " not found"));
        return rolePermissionRepo.findAllByRoleId(roleId).stream()
            .map(RolePermission::getPermissionCode)
            .sorted()
            .toList();
    }

    @Transactional(readOnly = true)
    public List<String> permissionsForUser(UUID userId) {
        List<UUID> roleIds = userRoleRepo.findAllByUserId(userId)
            .stream().map(UserRole::getRoleId).toList();
        if (roleIds.isEmpty()) return List.of();
        return rolePermissionRepo.findPermissionCodesByRoleIds(roleIds).stream()
            .distinct().sorted().toList();
    }

    /** A user's assigned roles plus the flattened set of permissions they grant. */
    public record UserRolesView(UUID userId, List<Role> roles, List<String> effectivePermissions) {}

    @Transactional(readOnly = true)
    public UserRolesView getUserRoles(UUID userId) {
        List<UUID> roleIds = userRoleRepo.findAllByUserId(userId)
            .stream().map(UserRole::getRoleId).toList();
        List<Role> roles = roleIds.isEmpty()
            ? List.of()
            : roleRepo.findAllById(roleIds);
        return new UserRolesView(userId, roles, permissionsForUser(userId));
    }

    public UserRole grant(UUID userId, UUID roleId) {
        UUID tenantId = TenantContext.requireTenantId();
        roleRepo.findById(roleId).orElseThrow(() ->
            new ResourceNotFoundException("Role " + roleId + " not found"));
        UserRole.PK pk = new UserRole.PK(tenantId, userId, roleId);
        UserRole assignment = userRoleRepo.findById(pk).orElseGet(() ->
            userRoleRepo.save(new UserRole(tenantId, userId, roleId)));
        events.publishEvent(new PermissionCacheEvictEvent(tenantId, userId));
        return assignment;
    }

    public void revoke(UUID userId, UUID roleId) {
        UUID tenantId = TenantContext.requireTenantId();
        UserRole.PK pk = new UserRole.PK(tenantId, userId, roleId);
        userRoleRepo.deleteById(pk);
        events.publishEvent(new PermissionCacheEvictEvent(tenantId, userId));
    }

    /**
     * Replace the entire permission set on a role. After update, all users
     * holding this role have their cache evicted.
     */
    public void setRolePermissions(UUID roleId, List<String> permissionCodes) {
        Role role = roleRepo.findById(roleId).orElseThrow(() ->
            new ResourceNotFoundException("Role " + roleId + " not found"));
        for (String code : permissionCodes) {
            permissionRepo.findById(code).orElseThrow(() ->
                new ResourceNotFoundException("Permission " + code + " not in catalog"));
        }
        List<RolePermission> existing = rolePermissionRepo.findAllByRoleId(roleId);
        rolePermissionRepo.deleteAllInBatch(existing);
        for (String code : permissionCodes) {
            rolePermissionRepo.save(new RolePermission(roleId, code));
        }
        // Evict cache for every user holding this role
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId != null) {
            userRoleRepo.findAllByRoleId(roleId)
                .forEach(ur -> events.publishEvent(
                    new PermissionCacheEvictEvent(ur.getTenantId(), ur.getUserId())));
        }
    }

    /** Create a custom tenant-scoped role by cloning an existing role's permission set. */
    public Role createCustomRole(String code, String displayName, String description,
                                  UUID cloneFromRoleId) {
        UUID tenantId = TenantContext.requireTenantId();
        if (roleRepo.existsByTenantIdAndCode(tenantId, code)) {
            throw new BusinessRuleException("Role code already exists in this tenant", "ROLE_CODE_DUPLICATE");
        }
        Role role = new Role();
        role.setId(UUID.randomUUID());
        role.setTenantId(tenantId);
        role.setCode(code);
        role.setDisplayName(displayName);
        role.setDescription(description);
        role.setSystemRole(false);
        role = roleRepo.save(role);

        if (cloneFromRoleId != null) {
            List<RolePermission> source = rolePermissionRepo.findAllByRoleId(cloneFromRoleId);
            final UUID newRoleId = role.getId();
            for (RolePermission rp : source) {
                rolePermissionRepo.save(new RolePermission(newRoleId, rp.getPermissionCode()));
            }
        }
        return role;
    }

    /** Rename / re-describe a custom (non-system) role owned by the current tenant. */
    public Role updateCustomRole(UUID roleId, String displayName, String description) {
        Role role = requireTenantCustomRole(roleId);
        role.setDisplayName(displayName);
        role.setDescription(description);
        return roleRepo.save(role);
    }

    /** Delete a custom role, removing its permission set and any user assignments. */
    public void deleteCustomRole(UUID roleId) {
        Role role = requireTenantCustomRole(roleId);
        rolePermissionRepo.deleteAllInBatch(rolePermissionRepo.findAllByRoleId(roleId));
        userRoleRepo.findAllByRoleId(roleId).forEach(ur -> {
            userRoleRepo.deleteById(new UserRole.PK(ur.getTenantId(), ur.getUserId(), ur.getRoleId()));
            events.publishEvent(new PermissionCacheEvictEvent(ur.getTenantId(), ur.getUserId()));
        });
        roleRepo.delete(role);
    }

    /** Guard: the role must exist, be a non-system role, and belong to the current tenant. */
    private Role requireTenantCustomRole(UUID roleId) {
        Role role = roleRepo.findById(roleId).orElseThrow(() ->
            new ResourceNotFoundException("Role " + roleId + " not found"));
        if (role.isSystemRole()) {
            throw new BusinessRuleException("System roles cannot be modified or deleted", "SYSTEM_ROLE_LOCKED");
        }
        UUID tenantId = TenantContext.requireTenantId();
        if (role.getTenantId() == null || !tenantId.equals(role.getTenantId())) {
            throw new BusinessRuleException("Role does not belong to this tenant", "ROLE_TENANT_MISMATCH");
        }
        return role;
    }
}
