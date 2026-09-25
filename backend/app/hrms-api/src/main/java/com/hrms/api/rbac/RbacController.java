package com.hrms.api.rbac;

import com.hrms.api.access.RoleAdminService;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.service.RbacService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Roles & permissions. Every change goes through {@link RoleAdminService},
 * which applies the levels rules (only what you hold, CRITICAL only by the
 * owner, never your own access) and writes an audit row.
 */
@RestController
@RequestMapping("/v1/rbac")
public class RbacController {

    private final RbacService rbac;
    private final RoleAdminService roles;

    public RbacController(RbacService rbac, RoleAdminService roles) {
        this.rbac = rbac;
        this.roles = roles;
    }

    public record CreateRoleRequest(String code, String displayName, String description, UUID cloneFromRoleId) {}
    public record UpdateRoleRequest(String displayName, String description) {}
    public record DuplicateRoleRequest(String displayName, String code, String description) {}

    @GetMapping("/roles")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public List<Role> listRoles() {
        return rbac.listVisibleRoles();
    }

    @PostMapping("/roles")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public Role createRole(@RequestBody CreateRoleRequest req, @AuthenticationPrincipal Jwt jwt) {
        return roles.create(req.code(), req.displayName(), req.description(), req.cloneFromRoleId(), actor(jwt));
    }

    /** Copy a built-in or custom role into a new custom role (code derived from the name when omitted). */
    @PostMapping("/roles/{roleId}/duplicate")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public Role duplicateRole(@PathVariable UUID roleId, @RequestBody DuplicateRoleRequest req,
                              @AuthenticationPrincipal Jwt jwt) {
        return roles.duplicate(roleId, req.displayName(), req.code(), req.description(), actor(jwt));
    }

    @PutMapping("/roles/{roleId}")
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public Role updateRole(@PathVariable UUID roleId, @RequestBody UpdateRoleRequest req,
                           @AuthenticationPrincipal Jwt jwt) {
        return roles.update(roleId, req.displayName(), req.description(), actor(jwt));
    }

    @DeleteMapping("/roles/{roleId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public void deleteRole(@PathVariable UUID roleId, @AuthenticationPrincipal Jwt jwt) {
        roles.delete(roleId, actor(jwt));
    }

    /** The catalogue, with each permission's description, risk level and warning. */
    @GetMapping("/permissions")
    @PreAuthorize("hasAnyAuthority('rbac.role.write','platform.admin','workspace.users.read','rbac.access.manage-overrides')")
    public List<RoleAdminService.PermissionDto> listPermissions() {
        return roles.catalogue();
    }

    @GetMapping("/roles/{roleId}/permissions")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public List<String> getRolePermissions(@PathVariable UUID roleId) {
        return rbac.getPermissionsForRole(roleId);
    }

    /**
     * Replace a custom role's permissions. Adding a HIGH or CRITICAL permission
     * needs {@code acknowledgeRisk=true} (the UI shows the warning first).
     */
    @PutMapping("/roles/{roleId}/permissions")
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public List<String> setRolePermissions(@PathVariable UUID roleId,
                                           @RequestBody List<String> permissionCodes,
                                           @RequestParam(value = "acknowledgeRisk", defaultValue = "false") boolean acknowledgeRisk,
                                           @AuthenticationPrincipal Jwt jwt) {
        return roles.setPermissions(roleId, permissionCodes, acknowledgeRisk, actor(jwt));
    }

    @GetMapping("/users/{userId}/roles")
    @PreAuthorize("hasAuthority('rbac.role.write') or hasAuthority('platform.admin')")
    public RbacService.UserRolesView getUserRoles(@PathVariable UUID userId) {
        return roles.userRoles(userId);
    }

    @PostMapping("/users/{userId}/roles/{roleId}")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public Map<String, Object> grant(@PathVariable UUID userId, @PathVariable UUID roleId,
                                     @AuthenticationPrincipal Jwt jwt) {
        roles.grant(userId, roleId, actor(jwt));
        return Map.of("userId", userId, "roleId", roleId);
    }

    @DeleteMapping("/users/{userId}/roles/{roleId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('rbac.role.write')")
    public void revoke(@PathVariable UUID userId, @PathVariable UUID roleId, @AuthenticationPrincipal Jwt jwt) {
        roles.revoke(userId, roleId, actor(jwt));
    }

    private static UUID actor(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
