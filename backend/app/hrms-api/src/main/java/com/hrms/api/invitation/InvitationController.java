package com.hrms.api.invitation;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
public class InvitationController {

    private final InvitationService invitationService;

    public InvitationController(InvitationService invitationService) {
        this.invitationService = invitationService;
    }

    /** Send invitation email to a newly created employee. */
    @PostMapping("/v1/employees/{id}/invite")
    @PreAuthorize("hasAuthority('hrms.employee.invite')")
    public ResponseEntity<InvitationService.InvitationResult> invite(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        UUID tenantId = TenantContext.getTenantId();
        UUID actorId  = UUID.fromString(jwt.getSubject());
        return ResponseEntity.ok(invitationService.sendInvitation(id, tenantId, actorId));
    }

    /** Resend invitation — invalidates the previous token and sends a fresh one. */
    @PostMapping("/v1/employees/{id}/invite/resend")
    @PreAuthorize("hasAuthority('hrms.employee.invite')")
    public ResponseEntity<InvitationService.InvitationResult> resend(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        UUID tenantId = TenantContext.getTenantId();
        UUID actorId  = UUID.fromString(jwt.getSubject());
        return ResponseEntity.ok(invitationService.resendInvitation(id, tenantId, actorId));
    }

    /** Public — employee sets their password using the token from their invite email. */
    @PostMapping("/v1/auth/accept-invite")
    @PreAuthorize("permitAll()")
    public ResponseEntity<InvitationService.AcceptInviteResponse> acceptInvite(
            @RequestBody AcceptInviteRequest req) {
        return ResponseEntity.ok(invitationService.acceptInvitation(req.token(), req.password()));
    }

    /** Public — request a password reset email. Always returns 200 (no email leak). */
    @PostMapping("/v1/auth/forgot-password")
    @PreAuthorize("permitAll()")
    public ResponseEntity<Void> forgotPassword(
            @RequestBody ForgotPasswordRequest req) {
        // Tenant context from X-Tenant-Subdomain or X-Tenant-ID header (set by TenantContextFilter)
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null && req.tenantId() != null) tenantId = req.tenantId();
        invitationService.requestPasswordReset(req.email(), tenantId);
        return ResponseEntity.ok().build();
    }

    /** Public — set a new password using the token from the reset email. */
    @PostMapping("/v1/auth/reset-password")
    @PreAuthorize("permitAll()")
    public ResponseEntity<Void> resetPassword(
            @RequestBody ResetPasswordRequest req) {
        invitationService.resetPassword(req.token(), req.password());
        return ResponseEntity.ok().build();
    }

    /**
     * Public — quick "is this reset token still valid?" check the SPA fires
     * before rendering the new-password form. Returns 200 {valid:true} when
     * the token exists, is unused, and hasn't expired; returns 200
     * {valid:false, reason:...} on any of the failure modes so the SPA can
     * show a friendly "this link has expired, request a new one" page
     * instead of a stack-trace-y 4xx.
     */
    @org.springframework.web.bind.annotation.GetMapping("/v1/auth/reset-password/verify")
    @PreAuthorize("permitAll()")
    public ResponseEntity<java.util.Map<String, Object>> verifyResetToken(
            @org.springframework.web.bind.annotation.RequestParam("token") String token) {
        try {
            invitationService.verifyResetToken(token);
            return ResponseEntity.ok(java.util.Map.of("valid", true));
        } catch (com.hrms.core.exception.BusinessRuleException ex) {
            return ResponseEntity.ok(java.util.Map.of(
                    "valid",  false,
                    "reason", ex.getErrorCode() == null ? "INVALID" : ex.getErrorCode(),
                    "message", ex.getMessage() == null ? "Reset link is not valid." : ex.getMessage()
            ));
        }
    }

    // ── Request DTOs ────────────────────────────────────────────────────────

    public record AcceptInviteRequest(String token, String password) {}

    public record ForgotPasswordRequest(String email, UUID tenantId) {}

    public record ResetPasswordRequest(String token, String password) {}
}
