package com.hrms.api.rbac;

import com.unifiedtree.rbac.entity.Permission;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.service.RbacService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/rbac")
public class RbacController {

    private final RbacService rbac;

    public RbacController(RbacService rbac) {
        this.rbac = rbac;
    }

    @GetMapping("/roles")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public List<Role> listRoles() {
        return rbac.listVisibleRoles();
    }

    @GetMapping("/permissions")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public List<Permission> listPermissions() {
        return rbac.listPermissions();
    }

    @GetMapping("/roles/{roleId}/permissions")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public List<String> getRolePermissions(@PathVariable UUID roleId) {
        return rbac.getPermissionsForRole(roleId);
    }

    @PutMapping("/roles/{roleId}/permissions")
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public void setRolePermissions(@PathVariable UUID roleId,
                                   @RequestBody List<String> permissionCodes) {
        rbac.setRolePermissions(roleId, permissionCodes);
    }

    @GetMapping("/users/{userId}/roles")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public RbacService.UserRolesView getUserRoles(@PathVariable UUID userId) {
        return rbac.getUserRoles(userId);
    }

    @PostMapping("/users/{userId}/roles/{roleId}")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public UserRole grant(@PathVariable UUID userId, @PathVariable UUID roleId) {
        return rbac.grant(userId, roleId);
    }

    @DeleteMapping("/users/{userId}/roles/{roleId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public void revoke(@PathVariable UUID userId, @PathVariable UUID roleId) {
        rbac.revoke(userId, roleId);
    }
}
