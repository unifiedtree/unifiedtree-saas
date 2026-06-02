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

    public WorkspaceAccessController(WorkspaceAccessService service) {
        this.service = service;
    }

    @GetMapping("/users")
    @PreAuthorize("hasAuthority('workspace.users.read')")
    public List<WorkspaceAccessService.WorkspaceUserDto> listUsers() {
        return service.listWorkspaceUsers(TenantContext.getTenantId());
    }

    @GetMapping("/assignable-roles")
    @PreAuthorize("hasAuthority('workspace.users.read')")
    public List<WorkspaceAccessService.AssignableRoleDto> assignableRoles() {
        return service.listAssignableRoles(TenantContext.getTenantId());
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

    public record AssignRoleRequest(String roleCode) {}
}
