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
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

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

    private static final com.fasterxml.jackson.databind.ObjectMapper OBJECT_MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper()
                    .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final AuthService auth;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    private final LoginRateLimiter rateLimiter;

    public CanonicalAuthController(AuthService auth,
                                   org.springframework.jdbc.core.JdbcTemplate jdbc,
                                   LoginRateLimiter rateLimiter) {
        this.auth = auth;
        this.jdbc = jdbc;
        this.rateLimiter = rateLimiter;
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
        if (slug == null || slug.isBlank()) {
            // Fall back to the Host header — the SDK sets X-Tenant-Subdomain on
            // most calls, but /refresh may fire from a boot path where the SDK
            // has not yet resolved the workspace slug. The registrable domain
            // is unifiedtree.com, so <workspace>.unifiedtree.com yields the
            // subdomain directly. Also accept host:port forms.
            slug = extractSubdomainFromHost(req.getHeader("Host"));
        }
        if (slug == null || slug.isBlank()) return null;
        return resolveTenantIdBySubdomain(slug.trim());
    }

    /**
     * Peel the workspace slug off a Host header like {@code acme.unifiedtree.com}
     * or {@code acme.unifiedtree.com:443}. Returns null for API/apex hosts
     * ({@code api.unifiedtree.com}, {@code www.unifiedtree.com}, bare
     * {@code unifiedtree.com}) — those don't belong to a specific workspace.
     */
    private static String extractSubdomainFromHost(String host) {
        if (host == null || host.isBlank()) return null;
        String h = host.trim().toLowerCase();
        int colon = h.indexOf(':');
        if (colon >= 0) h = h.substring(0, colon);
        int dot = h.indexOf('.');
        if (dot <= 0) return null;                       // no subdomain segment
        String first = h.substring(0, dot);
        if (first.equals("api") || first.equals("www")) return null;
        return first;
    }

    private UUID resolveTenantIdBySubdomain(String subdomain) {
        if (subdomain == null || subdomain.isBlank()) return null;
        try {
            return jdbc.queryForObject(
                    "SELECT id FROM platform.tenants WHERE lower(subdomain) = lower(?)",
                    UUID.class, subdomain);
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

    /**
     * Read the request body as a UTF-8 string. Returns empty string on any IO
     * error rather than throwing — the caller decides whether the body is
     * required.
     */
    private static String readRequestBody(HttpServletRequest req) {
        if (req.getContentLengthLong() == 0L) return "";
        try (java.io.BufferedReader r = req.getReader()) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[512];
            int n;
            while ((n = r.read(buf)) != -1) sb.append(buf, 0, n);
            return sb.toString();
        } catch (java.io.IOException e) {
            return "";
        }
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
     * B7 FIX (audit 2026-08-15): scan ALL {@code ut_rt_<tenant>} cookies on
     * the request and return the first {@code (tenantId, token)} pair with a
     * non-blank value. Used by refresh() so the tenant is resolved from the
     * cookie itself, not from the X-Tenant-ID header — which can be forged
     * cheaply and used to cross-workspace-hop a refresh from workspace A's
     * cookie against workspace B's tenant context.
     *
     * <p>Fallback-only. Callers with a known target tenant should call
     * {@link #findRefreshCookieForTenant} first — a multi-workspace browser
     * carries several {@code ut_rt_*} cookies and servlet iteration order is
     * not deterministic across containers, so blindly taking "first found"
     * could rotate the wrong workspace's refresh token.
     */
    private static java.util.Map.Entry<UUID, String> findAnyRefreshCookie(HttpServletRequest req) {
        if (req.getCookies() == null) return null;
        for (Cookie c : req.getCookies()) {
            String name = c.getName();
            if (name == null || !name.startsWith(RT_COOKIE_PREFIX)) continue;
            String value = c.getValue();
            if (value == null || value.isBlank()) continue;
            try {
                UUID tid = UUID.fromString(name.substring(RT_COOKIE_PREFIX.length()));
                return java.util.Map.entry(tid, value);
            } catch (IllegalArgumentException ignored) {
                // cookie name doesn't decode to a UUID; skip.
            }
        }
        return null;
    }

    /**
     * Preferred lookup when the caller already knows which workspace the
     * request is for (from the Host header or X-Tenant-Subdomain). Returns
     * the {@code ut_rt_<targetTenantId>} cookie value if present and
     * non-blank, otherwise null.
     */
    private static String findRefreshCookieForTenant(HttpServletRequest req, UUID targetTenantId) {
        if (req.getCookies() == null || targetTenantId == null) return null;
        String want = cookieName(targetTenantId);
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
        // ── Sliding-window rate-limit (Bundle H) ────────────────────────────
        // 5 failed attempts per email per 5 min → 429 with Retry-After. The
        // limiter is keyed BEFORE the tenant is resolved so an attacker who
        // guesses the tenant right can't reset the counter by omitting it
        // (and the mobile path doesn't send tenantId at all, so per-email is
        // the only stable key we have here).
        LoginRateLimiter.CheckResult gate = rateLimiter.check(req.email());
        if (!gate.allowed()) {
            log.warn("login blocked by rate limiter for email='{}' retryAfter={}s",
                    req.email(), gate.retryAfterSeconds());
            res.setHeader("Retry-After", Long.toString(gate.retryAfterSeconds()));
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Too many failed login attempts. Try again in "
                            + gate.retryAfterSeconds() + "s.");
        }

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
                // Count this as a failed attempt too — otherwise an attacker
                // could enumerate unknown emails cheaply and never trip the
                // limiter.
                rateLimiter.recordFailure(req.email());
                throw new com.hrms.core.exception.BusinessRuleException(
                        "Invalid email or password", "INVALID_CREDENTIALS");
            }
        }
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        LoginResponse out;
        try {
            out = auth.login(req);
        } catch (RuntimeException e) {
            // Any auth failure (INVALID_CREDENTIALS, ACCOUNT_LOCKED,
            // ACCOUNT_INACTIVE) counts against the limiter — otherwise an
            // attacker who tripped ACCOUNT_LOCKED once could keep pounding
            // forever without touching the per-email throttle.
            rateLimiter.recordFailure(req.email());
            throw e;
        }
        rateLimiter.recordSuccess(req.email());
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
    public LoginResponse refresh(HttpServletRequest httpReq,
                                 HttpServletResponse res) {
        // Two callers, two transports:
        //   mobile — sends the token in the JSON body (no cookie jar)
        //   web    — sends nothing; the httpOnly cookie rides along, which is
        //            the point: script cannot read or forge it.
        //
        // Historically this used @RequestBody(required=false), but Spring's
        // message converter still ran on a truly empty POST (Content-Length: 0)
        // and threw before the method body — surfacing as 500. Reading the
        // stream ourselves keeps every path (empty body, {}, {refreshToken:…},
        // malformed JSON, or cookie-only) inside our own try/catch and out of
        // the framework's converter chain.
        // Resolve which workspace the browser is currently on BEFORE picking
        // a cookie. The order matters:
        //   1. Host / X-Tenant-Subdomain → tenantId  (this is what the user's
        //      tab is actually pointed at)
        //   2. Look for ut_rt_<thatTenantId> specifically. A multi-workspace
        //      user carries several ut_rt_* cookies; iterating and taking the
        //      first would rotate the WRONG tenant's refresh token when the
        //      browser hands them to us in a different order.
        //   3. Only if no target-tenant cookie is present do we fall back to
        //      "first found" — that preserves the mobile / single-workspace
        //      path where no header is set.
        // The body-token path (mobile) is unchanged — mobile clients supply
        // their own tenant in the header.
        UUID tenantId = resolveTenant(httpReq);
        String bodyToken = null;
        try {
            String raw = readRequestBody(httpReq);
            if (raw != null && !raw.isBlank()) {
                RefreshRequest parsed = OBJECT_MAPPER.readValue(raw, RefreshRequest.class);
                if (parsed != null && parsed.refreshToken() != null && !parsed.refreshToken().isBlank()) {
                    bodyToken = parsed.refreshToken();
                }
            }
        } catch (java.io.IOException ignored) {
            // Malformed / non-JSON body: fall through to cookie lookup rather
            // than 400ing. Cookie-based callers already send no body at all.
        }
        String token;
        if (bodyToken != null) {
            token = bodyToken;
        } else {
            // Cookie path — prefer the exact target-tenant cookie.
            String targetCookie = findRefreshCookieForTenant(httpReq, tenantId);
            if (targetCookie != null) {
                token = targetCookie;
                TenantContext.setTenantId(tenantId);
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
            } else {
                // No cookie for the resolved workspace. Two cases:
                //   a) header not set at all (mobile / boot path) → legitimate
                //      first-found fallback
                //   b) header IS set but that workspace has no cookie in this
                //      browser → also fall back, but log the mismatch so we
                //      notice cross-workspace cookie confusion in the wild.
                java.util.Map.Entry<UUID, String> cookiePair = findAnyRefreshCookie(httpReq);
                if (cookiePair != null) {
                    if (tenantId != null && !tenantId.equals(cookiePair.getKey())) {
                        log.warn("REFRESH_COOKIE_TENANT_MISMATCH resolved tenant={} but only cookie present is for tenant={}; falling back to cookie tenant",
                                tenantId, cookiePair.getKey());
                    }
                    tenantId = cookiePair.getKey();
                    token = cookiePair.getValue();
                    TenantContext.setTenantId(tenantId);
                    com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
                } else {
                    token = null;
                }
            }
        }

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
