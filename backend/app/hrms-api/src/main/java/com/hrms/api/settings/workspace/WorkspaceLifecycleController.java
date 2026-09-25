package com.hrms.api.settings.workspace;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Scheduled workspace reset / deletion (Settings -> Danger zone):
 * <pre>
 *   GET  /v1/workspace/lifecycle-requests                 requests + what reset/delete remove and keep
 *   POST /v1/workspace/lifecycle-requests                 {kind: RESET|DELETE, confirmName, reason?}
 *                                                          OWNER role only; 7-day wait; owners/admins emailed
 *   POST /v1/workspace/lifecycle-requests/{id}/cancel     any holder of the permission (owners, super admins)
 * </pre>
 * Nothing is deleted by these endpoints; see {@link WorkspaceLifecycleService}.
 */
@RestController
@RequestMapping("/v1/workspace/lifecycle-requests")
@SecurityRequirement(name = "bearerAuth")
public class WorkspaceLifecycleController {

    private final WorkspaceLifecycleService lifecycle;

    public WorkspaceLifecycleController(WorkspaceLifecycleService lifecycle) {
        this.lifecycle = lifecycle;
    }

    public record CreateRequest(String kind, String confirmName, String reason) {}

    @Operation(summary = "Reset / deletion requests and what each would remove")
    @GetMapping
    @PreAuthorize("hasAuthority('workspace.lifecycle.manage')")
    public WorkspaceLifecycleService.Overview overview() {
        return lifecycle.overview(tenant(), TenantContext.getUserId());
    }

    @Operation(summary = "Schedule a workspace reset or deletion (7-day wait, owner only)")
    @PostMapping
    @PreAuthorize("hasAuthority('workspace.lifecycle.manage')")
    public ResponseEntity<WorkspaceLifecycleService.RequestView> create(@AuthenticationPrincipal Jwt jwt, @RequestBody CreateRequest body) {
        if (body == null) throw new BusinessRuleException("Choose reset or delete.", "LIFECYCLE_KIND_INVALID");
        return ResponseEntity.status(HttpStatus.CREATED).body(lifecycle.request(tenant(), TenantContext.getUserId(),
                email(jwt), body.kind(), body.confirmName(), body.reason()));
    }

    @Operation(summary = "Cancel a scheduled reset or deletion")
    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('workspace.lifecycle.manage')")
    public WorkspaceLifecycleService.RequestView cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return lifecycle.cancel(tenant(), email(jwt), id);
    }

    private static String email(Jwt jwt) {
        return jwt == null ? null : jwt.getClaimAsString("email");
    }

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        return t;
    }
}
