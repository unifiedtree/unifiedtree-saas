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

    public record CreateRoleRequest(String code, String displayName, String description, UUID cloneFromRoleId) {}
    public record UpdateRoleRequest(String displayName, String description) {}

    @GetMapping("/roles")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public List<Role> listRoles() {
        return rbac.listVisibleRoles();
    }

    @PostMapping("/roles")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public Role createRole(@RequestBody CreateRoleRequest req) {
        return rbac.createCustomRole(req.code(), req.displayName(), req.description(), req.cloneFromRoleId());
    }

    @PutMapping("/roles/{roleId}")
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public Role updateRole(@PathVariable UUID roleId, @RequestBody UpdateRoleRequest req) {
        return rbac.updateCustomRole(roleId, req.displayName(), req.description());
    }

    @DeleteMapping("/roles/{roleId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public void deleteRole(@PathVariable UUID roleId) {
        rbac.deleteCustomRole(roleId);
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
