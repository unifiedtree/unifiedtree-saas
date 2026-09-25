package com.hrms.api.rbac;

import com.unifiedtree.rbac.entity.Permission;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.entity.RolePermission;
import com.unifiedtree.rbac.repository.PermissionRepository;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.rbac.service.RbacService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Saving a custom role's permissions used to delete every row in a batch and
 * then save() the whole list again. save() merges (the id is assigned), finds
 * the old row still in the persistence context and inserts nothing, so only
 * newly added permissions survived. setRolePermissions now applies the
 * difference: rows no longer wanted are deleted, only new codes are inserted.
 */
class RoleRepermissionKeepsExistingTest {

    @AfterEach void clearTenant() { TenantContext.clear(); }

    @Test
    @SuppressWarnings("unchecked")
    void addingOnePermissionKeepsTheOthersAndRemovingOneDeletesOnlyIt() {
        UUID tenant = UUID.randomUUID();
        UUID roleId = UUID.randomUUID();
        TenantContext.setTenantId(tenant);

        RoleRepository roles = mock(RoleRepository.class);
        PermissionRepository perms = mock(PermissionRepository.class);
        RolePermissionRepository rolePerms = mock(RolePermissionRepository.class);
        UserRoleRepository userRoles = mock(UserRoleRepository.class);
        Role role = new Role();
        role.setId(roleId);
        role.setTenantId(tenant);
        role.setSystemRole(false);
        when(roles.findById(roleId)).thenReturn(Optional.of(role));
        when(perms.findById(anyString())).thenReturn(Optional.of(mock(Permission.class)));
        when(rolePerms.findAllByRoleId(roleId)).thenReturn(List.of(
                new RolePermission(roleId, "a.keep"), new RolePermission(roleId, "b.keep"), new RolePermission(roleId, "c.drop")));
        when(userRoles.findAllByRoleId(roleId)).thenReturn(List.of());

        new RbacService(roles, perms, rolePerms, userRoles, mock(ApplicationEventPublisher.class))
                .setRolePermissions(roleId, List.of("a.keep", "b.keep", "d.new"));

        ArgumentCaptor<Iterable<RolePermission>> deleted = ArgumentCaptor.forClass(Iterable.class);
        verify(rolePerms).deleteAll(deleted.capture());
        List<String> deletedCodes = new java.util.ArrayList<>();
        deleted.getValue().forEach(rp -> deletedCodes.add(rp.getPermissionCode()));
        assertEquals(List.of("c.drop"), deletedCodes);

        ArgumentCaptor<RolePermission> saved = ArgumentCaptor.forClass(RolePermission.class);
        verify(rolePerms, times(1)).save(saved.capture());
        assertEquals("d.new", saved.getValue().getPermissionCode());
        verify(rolePerms, never()).deleteAllInBatch(any(Collection.class));
    }
}
