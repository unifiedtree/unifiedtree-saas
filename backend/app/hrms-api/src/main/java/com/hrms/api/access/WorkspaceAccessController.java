package com.hrms.api.access;

import com.hrms.api.invitation.InvitationService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Workspace Users & Access (Prompt 10). Admin-only surface for listing every
 * user in the workspace, managing their roles (grouped by module), and inviting
 * new users (reusing the Prompt 9 invitation flow).
 */
@RestController
@RequestMapping("/v1/workspace")
public class WorkspaceAccessController {

    private final WorkspaceAccessService service;
    private final UserPermissionService permissions;

    public WorkspaceAccessController(WorkspaceAccessService service, UserPermissionService permissions) {
        this.service = service;
        this.permissions = permissions;
    }

    @GetMapping("/users")
    @PreAuthorize("hasAuthority('workspace.users.read')")
    public List<WorkspaceAccessService.WorkspaceUserDto> listUsers() {
        return service.listWorkspaceUsers(TenantContext.getTenantId());
    }

    @GetMapping("/assignable-roles")
    @PreAuthorize("hasAuthority('workspace.users.read')")
    public List<WorkspaceAccessService.AssignableRoleDto> assignableRoles(@AuthenticationPrincipal Jwt jwt) {
        return service.listAssignableRoles(TenantContext.getTenantId(), UUID.fromString(jwt.getSubject()));
    }

    /**
     * One person's access: their roles, every permission they end up with and
     * where it comes from, their individual extra / removed permissions, and
     * whether the caller may change them (and which permissions they could give).
     */
    @GetMapping("/users/{userId}/permissions")
    @PreAuthorize("hasAnyAuthority('workspace.users.read','rbac.access.manage-overrides')")
    public UserPermissionService.UserPermissionsView userPermissions(@PathVariable UUID userId,
                                                                    @AuthenticationPrincipal Jwt jwt) {
        return permissions.view(userId, UUID.fromString(jwt.getSubject()));
    }

    /**
     * Replace one person's individual permission overrides with this list
     * (GRANT = extra, DENY = removed; reason required, end date optional).
     * Levels apply: never your own access, only what you hold, CRITICAL only by
     * the owner, HIGH / CRITICAL only with {@code acknowledgeRisk}.
     */
    @PutMapping("/users/{userId}/permissions")
    @PreAuthorize("hasAuthority('rbac.access.manage-overrides')")
    public UserPermissionService.UserPermissionsView replaceUserPermissions(
            @PathVariable UUID userId,
            @RequestBody UserPermissionService.PutPermissionsRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return permissions.replace(userId, UUID.fromString(jwt.getSubject()), req);
    }

    @PostMapping("/users/{userId}/roles")
    @PreAuthorize("hasAuthority('workspace.users.manage')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void assignRole(@PathVariable UUID userId,
                           @RequestBody AssignRoleRequest req,
                           @AuthenticationPrincipal Jwt jwt) {
        service.assignRole(TenantContext.getTenantId(), userId, req.roleCode(), UUID.fromString(jwt.getSubject()));
    }

    @DeleteMapping("/users/{userId}/roles/{roleCode}")
    @PreAuthorize("hasAuthority('workspace.users.manage')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeRole(@PathVariable UUID userId,
                           @PathVariable String roleCode,
                           @AuthenticationPrincipal Jwt jwt) {
        service.revokeRole(TenantContext.getTenantId(), userId, roleCode, UUID.fromString(jwt.getSubject()));
    }

    @PostMapping("/users/invite")
    @PreAuthorize("hasAuthority('workspace.users.manage')")
    public InvitationService.InvitationResult inviteUser(@RequestBody WorkspaceAccessService.InviteRequest req,
                                                         @AuthenticationPrincipal Jwt jwt) {
        return service.inviteUser(TenantContext.getTenantId(), UUID.fromString(jwt.getSubject()), req);
    }

    /** Re-send the invitation email to an invited user who lost the original. */
    @PostMapping("/users/{userId}/invite/resend")
    @PreAuthorize("hasAuthority('workspace.users.manage')")
    public InvitationService.InvitationResult resendInvite(@PathVariable UUID userId,
                                                           @AuthenticationPrincipal Jwt jwt) {
        return service.resendInvite(TenantContext.getTenantId(), userId, UUID.fromString(jwt.getSubject()));
    }

    public record AssignRoleRequest(String roleCode) {}
}
