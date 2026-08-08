package com.hrms.api.auth.canonical;

import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.dto.AuthDtos.MeResponse;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

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

    private static final Logger log = LoggerFactory.getLogger(CanonicalAuthController.class);

    /**
     * Refresh-token cookie name PREFIX. The tenant id is appended, giving one
     * cookie per workspace.
     *
     * <p>This is not cosmetic. The browser sends cookies to the API host
     * (api.unifiedtree.com) regardless of which workspace page made the call,
     * so a single shared {@code ut_rt} cookie would mean: sign in to workspace
     * A, open workspace B, and B's boot-time refresh presents A's token and
     * restores A's session on B's domain. One cookie per tenant makes that
     * impossible — B simply finds no cookie of its own and shows the login
     * page, which is correct.
     */
    private static final String RT_COOKIE_PREFIX = "ut_rt_";
    /** Matches the refresh-token TTL in JwtService (7 days). */
    private static final int RT_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

    private final AuthService auth;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public CanonicalAuthController(AuthService auth,
                                   org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.auth = auth;
        this.jdbc = jdbc;
    }

    /**
     * Which workspace is this request for?
     *
     * <p>Resolved explicitly rather than read from {@link TenantContext},
     * because /refresh and /logout are permitAll and the tenant filter does
     * not populate the context on unauthenticated paths — leaving it null,
     * which silently made every cookie lookup miss and every reload look like
     * a signed-out user.
     *
     * <p>Falls back through the same signals the SDK sends on every call:
     * the X-Tenant-Subdomain header (set from the hostname) and X-Tenant-ID.
     */
    private UUID resolveTenant(HttpServletRequest req) {
        UUID ctx = TenantContext.getTenantId();
        if (ctx != null) return ctx;

        String id = req.getHeader("X-Tenant-ID");
        if (id != null && !id.isBlank()) {
            try { return UUID.fromString(id.trim()); } catch (IllegalArgumentException ignored) { /* fall through */ }
        }
        String slug = req.getHeader("X-Tenant-Subdomain");
        if (slug == null || slug.isBlank()) return null;
        try {
            return jdbc.queryForObject(
                    "SELECT id FROM platform.tenants WHERE lower(subdomain) = lower(?)",
                    UUID.class, slug.trim());
        } catch (RuntimeException e) {
            return null;   // unknown workspace — treated as "no session"
        }
    }

    private static String cookieName(UUID tenantId) {
        // Cookie names may not contain '-'; UUIDs do.
        return RT_COOKIE_PREFIX + tenantId.toString().replace("-", "");
    }

    /**
     * Persist the refresh token as an httpOnly cookie so a page reload can
     * restore the session.
     *
     * <p>Attributes and why:
     * <ul>
     *   <li><b>HttpOnly</b> — script cannot read it, so an XSS bug cannot
     *       exfiltrate the long-lived credential. The short-lived access token
     *       deliberately stays in memory only, never in storage.</li>
     *   <li><b>Secure</b> — HTTPS only.</li>
     *   <li><b>Domain=.unifiedtree.com</b> — set by api.unifiedtree.com but
     *       must travel from every {@code <workspace>.unifiedtree.com} page.</li>
     *   <li><b>SameSite=Lax</b> — sufficient, because a workspace subdomain and
     *       the API share the registrable domain unifiedtree.com, so these are
     *       same-site requests. Lax still blocks genuinely cross-site sends,
     *       which is the CSRF-relevant case.</li>
     * </ul>
     *
     * <p>The token is ALSO still returned in the JSON body: the mobile app has
     * no cookie jar and continues to use the body flow unchanged.
     */
    private void writeRefreshCookie(HttpServletResponse res, UUID tenantId, String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank() || tenantId == null) return;
        res.addHeader("Set-Cookie", String.join("; ",
                cookieName(tenantId) + "=" + refreshToken,
                "Max-Age=" + RT_COOKIE_MAX_AGE_SECONDS,
                "Path=/",
                "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    private void clearRefreshCookie(HttpServletResponse res, UUID tenantId) {
        if (tenantId == null) return;
        res.addHeader("Set-Cookie", String.join("; ",
                cookieName(tenantId) + "=",
                "Max-Age=0", "Path=/", "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    private static String readRefreshCookie(HttpServletRequest req, UUID tenantId) {
        if (req.getCookies() == null || tenantId == null) return null;
        String want = cookieName(tenantId);
        for (Cookie c : req.getCookies()) {
            if (want.equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank()) {
                return c.getValue();
            }
        }
        return null;
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
    public LoginResponse login(@Valid @RequestBody LoginRequest req, HttpServletResponse res) {
        // tenantId is optional. When absent (email-only mobile login), resolve
        // the workspace from the email HERE — before AuthService.login's
        // @Transactional boundary — so the connection is leased with the correct
        // tenant and RLS can see the credential row. resolveLoginTenant scans the
        // known tenants and returns null for unknown/ambiguous emails, surfaced
        // here as a generic invalid-credentials error.
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
        LoginResponse out = auth.login(req);
        // Persist the refresh token so a reload can restore this session. Web
        // clients never touch it (httpOnly); mobile keeps using the copy in
        // the response body.
        writeRefreshCookie(res, tenantId, out.refreshToken());
        return out;
    }

    @GetMapping("/me")
    @PreAuthorize("isAuthenticated()")
    public MeResponse me() {
        return auth.currentUser();
    }

    /**
     * Rotate access token using a refresh token. Public — the refresh token
     * itself is the credential. Without this endpoint, every brief 401 (token
     * expiry, network blip) forces the mobile app to clear tokens and
     * re-prompt the login screen — terrible Play-Store experience.
     */
    @PostMapping("/refresh")
    public LoginResponse refresh(@RequestBody(required = false) RefreshRequest req,
                                 HttpServletRequest httpReq,
                                 HttpServletResponse res) {
        // Two callers, two transports:
        //   mobile — sends the token in the JSON body (no cookie jar)
        //   web    — sends nothing; the httpOnly cookie rides along, which is
        //            the point: script cannot read or forge it.
        //
        // The body is @RequestBody(required=false) with no @NotBlank because a
        // cookie-only call has no body at all and would otherwise be rejected
        // at binding, before this method ever runs.
        UUID tenantId = resolveTenant(httpReq);
        String token = req != null && req.refreshToken() != null && !req.refreshToken().isBlank()
                ? req.refreshToken()
                : readRefreshCookie(httpReq, tenantId);

        if (token == null || token.isBlank()) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "No refresh token supplied", "REFRESH_MISSING");
        }

        LoginResponse out;
        try {
            out = auth.refresh(token);
        } catch (RuntimeException e) {
            // Expired, revoked, or already rotated. Drop the cookie so the
            // browser stops replaying a dead credential on every page load.
            clearRefreshCookie(res, tenantId);
            throw e;
        }
        // refresh() ROTATES: the presented token is deleted and a new one
        // issued. The cookie must be rewritten or the next reload would send a
        // token that no longer exists and log the user out.
        writeRefreshCookie(res, tenantId, out.refreshToken());
        return out;
    }

    /**
     * Sign out of THIS workspace: kill the cookie so a reload cannot restore
     * the session. Without this, "log out" only dropped the in-memory access
     * token and the very next page load would silently sign the user back in.
     *
     * <p>Scoped to the current tenant's cookie, so signing out of one
     * workspace leaves other workspaces in the same browser signed in.
     */
    @PostMapping("/logout")
    public java.util.Map<String, Object> logout(HttpServletRequest httpReq, HttpServletResponse res) {
        UUID tenantId = resolveTenant(httpReq);
        String token = readRefreshCookie(httpReq, tenantId);
        boolean revoked = false;
        if (token != null) {
            try {
                auth.revokeRefreshToken(token, tenantId);
                revoked = true;
            } catch (RuntimeException e) {
                // Already gone is a fine outcome for a logout.
                log.debug("logout: refresh token could not be revoked ({})", e.getMessage());
            }
        }
        clearRefreshCookie(res, tenantId);
        return java.util.Map.of("loggedOut", true, "tokenRevoked", revoked);
    }

    public record RefreshRequest(String refreshToken) {}
}
