package com.hrms.api.me;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.session.SessionService;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The signed-in person's own sign-in security (Settings -> Security):
 * two-factor set-up, recovery codes, turning it off, and their signed-in
 * sessions. Everything acts on the caller's own account only; the account is
 * taken from the access token, never from the request.
 *
 * <pre>
 *   GET    /v1/me/security                        status + workspace rule
 *   POST   /v1/me/security/totp/setup             QR code + secret (pending until confirmed)
 *   POST   /v1/me/security/totp/confirm  {code}   turn on; returns recovery codes (shown once)
 *   POST   /v1/me/security/totp/disable  {code}   turn off (needs a code; refused if the workspace requires it)
 *   POST   /v1/me/security/recovery-codes {code}  new recovery codes; old ones stop working
 *   GET    /v1/me/security/sessions               signed-in sessions
 *   DELETE /v1/me/security/sessions/{id}          sign one session out
 *   POST   /v1/me/security/sessions/sign-out-others
 * </pre>
 */
@RestController
@RequestMapping("/v1/me/security")
@SecurityRequirement(name = "bearerAuth")
public class MySecurityController {

    private final MfaService mfa;
    private final SessionService sessions;
    private final AuditService audit;

    public MySecurityController(MfaService mfa, SessionService sessions, AuditService audit) {
        this.mfa = mfa;
        this.sessions = sessions;
        this.audit = audit;
    }

    public record CodeRequest(String code) {
        @Override public String toString() { return "CodeRequest[REDACTED]"; }
    }

    public record RecoveryCodesResponse(List<String> recoveryCodes) {}

    @Operation(summary = "My two-factor status and the workspace sign-in rule")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public MfaService.Status status(@AuthenticationPrincipal Jwt jwt) {
        return mfa.status(tenant(), user(), roles(jwt));
    }

    @Operation(summary = "Start two-factor set-up: QR code and secret for the authenticator app")
    @PostMapping("/totp/setup")
    @PreAuthorize("isAuthenticated()")
    public MfaService.SetupInfo setup() {
        return mfa.beginSetup(tenant(), user());
    }

    @Operation(summary = "Finish set-up with a code from the app; returns recovery codes once")
    @PostMapping("/totp/confirm")
    @PreAuthorize("isAuthenticated()")
    public RecoveryCodesResponse confirm(@RequestBody CodeRequest body) {
        MfaService.CodesResult r = mfa.confirmSetup(tenant(), user(), code(body));
        switch (r.result()) {
            case OK -> { }
            case NO_PENDING -> throw new HrmsException("The QR code expired. Start set-up again.", HttpStatus.CONFLICT, "MFA_SETUP_EXPIRED");
            case ALREADY_ENABLED -> throw new HrmsException("Two-factor sign-in is already on.", HttpStatus.CONFLICT, "MFA_ALREADY_ENABLED");
            default -> throw new BusinessRuleException("That code isn't right. Check your authenticator app and try again.", "MFA_CODE_INVALID");
        }
        audit.record("security", "MFA_ENABLED", "user", user(), "Turned on two-factor sign-in");
        return new RecoveryCodesResponse(r.recoveryCodes());
    }

    @Operation(summary = "Turn two-factor off (needs a current code or a recovery code)")
    @PostMapping("/totp/disable")
    @PreAuthorize("isAuthenticated()")
    public Map<String, Object> disable(@AuthenticationPrincipal Jwt jwt, @RequestBody CodeRequest body) {
        UUID tenantId = tenant();
        if (MfaService.policyCovers(mfa.policy(tenantId), roles(jwt))) {
            throw new HrmsException("Your workspace requires two-factor sign-in for you, so it can't be turned off. "
                    + "If you changed phones, set it up again on the new phone first, or ask an admin.",
                    HttpStatus.CONFLICT, "MFA_REQUIRED_BY_WORKSPACE");
        }
        MfaService.CheckResult r = mfa.disable(tenantId, user(), code(body));
        refuseUnlessOk(r);
        audit.record("security", "MFA_DISABLED", "user", user(), "Turned off two-factor sign-in");
        return Map.of("enabled", false);
    }

    @Operation(summary = "Replace my recovery codes (needs a current code)")
    @PostMapping("/recovery-codes")
    @PreAuthorize("isAuthenticated()")
    public RecoveryCodesResponse regenerate(@RequestBody CodeRequest body) {
        MfaService.CodesResult r = mfa.regenerateRecoveryCodes(tenant(), user(), code(body));
        refuseUnlessOk(r.result());
        audit.record("security", "MFA_RECOVERY_CODES_REPLACED", "user", user(), "Replaced two-factor recovery codes");
        return new RecoveryCodesResponse(r.recoveryCodes());
    }

    @Operation(summary = "My signed-in sessions")
    @GetMapping("/sessions")
    @PreAuthorize("isAuthenticated()")
    public List<SessionService.SessionView> listSessions(@AuthenticationPrincipal Jwt jwt) {
        return sessions.list(user(), sid(jwt));
    }

    @Operation(summary = "Sign one of my sessions out")
    @DeleteMapping("/sessions/{sessionId}")
    @PreAuthorize("isAuthenticated()")
    public Map<String, Object> revoke(@PathVariable UUID sessionId) {
        int n = sessions.revoke(tenant(), user(), sessionId);
        if (n == 0) throw new HrmsException("That session has already ended.", HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND");
        audit.record("security", "SESSION_SIGNED_OUT", "session", sessionId, "Signed out one session");
        return Map.of("signedOut", 1);
    }

    @Operation(summary = "Sign out every session except this one")
    @PostMapping("/sessions/sign-out-others")
    @PreAuthorize("isAuthenticated()")
    public Map<String, Object> revokeOthers(@AuthenticationPrincipal Jwt jwt) {
        UUID current = sid(jwt);
        if (current == null) {
            throw new HrmsException("Reload the page and try again, so we know which session is this one.",
                    HttpStatus.CONFLICT, "SESSION_UNKNOWN");
        }
        int n = sessions.revokeOthers(tenant(), user(), current);
        audit.record("security", "SESSIONS_SIGNED_OUT", "user", user(), "Signed out " + n + " other session(s)");
        return Map.of("signedOut", n);
    }

    // ---- helpers ------------------------------------------------------------

    static void refuseUnlessOk(MfaService.CheckResult r) {
        switch (r) {
            case OK, OK_RECOVERY -> { }
            case NOT_ENABLED -> throw new HrmsException("Two-factor sign-in is not on.", HttpStatus.CONFLICT, "MFA_NOT_ENABLED");
            case LOCKED -> throw new HrmsException("Too many wrong codes. Try again in 15 minutes.", HttpStatus.LOCKED, "MFA_LOCKED");
            default -> throw new BusinessRuleException("That code isn't right. Check your authenticator app and try again.", "MFA_CODE_INVALID");
        }
    }

    private static String code(CodeRequest body) {
        String c = body == null || body.code() == null ? "" : body.code().trim();
        if (c.isEmpty()) throw new BusinessRuleException("Enter the code from your authenticator app.", "MFA_CODE_MISSING");
        return c;
    }

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        return t;
    }

    private static UUID user() {
        UUID u = TenantContext.getUserId();
        if (u == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        return u;
    }

    static List<String> roles(Jwt jwt) {
        if (jwt == null) return List.of();
        List<String> r = jwt.getClaimAsStringList("roles");
        return r == null ? List.of() : r;
    }

    private static UUID sid(Jwt jwt) {
        if (jwt == null) return null;
        String s = jwt.getClaimAsString("sid");
        if (s == null || s.isBlank()) return null;
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { return null; }
    }
}
