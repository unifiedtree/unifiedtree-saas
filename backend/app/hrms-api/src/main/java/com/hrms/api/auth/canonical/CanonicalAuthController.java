package com.hrms.api.auth.canonical;

import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.dto.AuthDtos.MeResponse;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/**
 * Canonical login endpoint. Distinct base path from the legacy auth
 * controller so both can coexist while the migration completes.
 *
 *   POST /v1/canonical-auth/login   -> returns JWT + refresh token
 *   GET  /v1/canonical-auth/me      -> echoes identity from current JWT
 */
@RestController
@RequestMapping("/v1/canonical-auth")
public class CanonicalAuthController {

    private final AuthService auth;

    public CanonicalAuthController(AuthService auth) {
        this.auth = auth;
    }

    /**
     * Trusting the request-body tenantId is safe BECAUSE the next line
     * checks the password. The credential lookup is scoped to that tenant;
     * a wrong tenantId would simply fail to find a matching user.
     *
     * <p>The tenant must be seeded BEFORE the @Transactional boundary in
     * AuthService.login -- otherwise Spring opens the connection without
     * a tenant set, TenantAwareDataSource skips SET LOCAL, RLS hides the
     * credential row, and login always returns INVALID_CREDENTIALS.
     */
    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest req) {
        // tenantId is optional. When absent (email-only mobile login), resolve
        // the workspace from the email HERE — before AuthService.login's
        // @Transactional boundary — so the connection is leased with the correct
        // tenant and RLS can see the credential row. resolveLoginTenant returns
        // null for unknown/ambiguous emails (and when the SECURITY DEFINER
        // resolver function isn't deployed yet), surfaced as generic invalid creds.
        java.util.UUID tenantId = req.tenantId();
        if (tenantId == null) {
            tenantId = auth.resolveLoginTenant(req.email());
            if (tenantId == null) {
                throw new com.hrms.core.exception.BusinessRuleException(
                        "Invalid email or password", "INVALID_CREDENTIALS");
            }
        }
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        return auth.login(req);
    }

    @GetMapping("/me")
    @PreAuthorize("isAuthenticated()")
    public MeResponse me() {
        return auth.currentUser();
    }
}
