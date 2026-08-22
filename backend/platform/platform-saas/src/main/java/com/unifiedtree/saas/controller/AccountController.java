package com.unifiedtree.saas.controller;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.saas.dto.AccountDtos.AccountLoginRequest;
import com.unifiedtree.saas.dto.AccountDtos.AccountLoginResponse;
import com.unifiedtree.saas.dto.AccountDtos.CreateWorkspaceRequest;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSessionRequest;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSessionResponse;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSummary;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.service.AccountService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.List;
import java.util.UUID;

/**
 * Global account portal and workspace switcher.
 *
 * <p>Flow:
 * <ol>
 *   <li>POST /v1/accounts/auth/login -> account token + workspace list.</li>
 *   <li>POST /v1/accounts/auth/refresh -> rotate the httpOnly refresh cookie
 *       and reissue the short-lived account access token. Web reload flow.</li>
 *   <li>POST /v1/accounts/auth/logout -> revoke the cookie's refresh row and
 *       clear the cookie.</li>
 *   <li>POST /v1/accounts/workspaces -> create another owned workspace.</li>
 *   <li>POST /v1/accounts/workspaces/session -> tenant ERP token.</li>
 *   <li>GET /v1/workspace/context -> app-shell module dashboard metadata.</li>
 * </ol>
 */
@RestController
public class AccountController {

    private static final Logger log = LoggerFactory.getLogger(AccountController.class);

    /**
     * Cookie name for the account-tier refresh token. Deliberately NOT
     * tenant-scoped (unlike ut_rt_&lt;tenantId&gt; on CanonicalAuthController) —
     * the account portal PRECEDES the tenant choice, and one account has one
     * ambient sign-in state across the marketing site + workspace picker.
     */
    private static final String RT_COOKIE_NAME = "ut_acct_rt";

    /** Matches AccountService.ACCOUNT_REFRESH_TTL (30 days). */
    private static final int RT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

    /**
     * Per-workspace refresh cookie, written on "Enter Workspace". Name and TTL
     * MUST match CanonicalAuthController's RT_COOKIE_PREFIX / 7-day max-age —
     * that controller owns the /refresh endpoint which reads this cookie back.
     */
    private static final String WORKSPACE_RT_COOKIE_PREFIX = "ut_rt_";
    private static final int WORKSPACE_RT_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final AccountService accounts;
    private final PublicEndpointRateLimiter rateLimiter;

    public AccountController(AccountService accounts, PublicEndpointRateLimiter rateLimiter) {
        this.accounts = accounts;
        this.rateLimiter = rateLimiter;
    }

    /**
     * Bundle B4 — rate-limited BEFORE credential check so brute-force
     * enumeration hits the 429 wall before it can walk the accounts table.
     * The DB-side {@code failed_login_count / locked_until} logic in
     * {@link AccountService#login} still runs on any request the limiter
     * lets through, as defence-in-depth against a compromised low-and-slow
     * source that stays under the per-window threshold.
     *
     * <p>After a successful sign-in a refresh token is minted and written into
     * the {@code ut_acct_rt} httpOnly cookie so a page reload can restore the
     * session without exposing the credential to JavaScript. The response body
     * shape is unchanged — mobile keeps working with the access token alone
     * until it opts into the cookie/body refresh flow.
     */
    @PostMapping("/v1/accounts/auth/login")
    public AccountLoginResponse login(@Valid @RequestBody AccountLoginRequest request,
                                      HttpServletRequest http,
                                      HttpServletResponse res) {
        rateLimiter.check("accounts-auth-login", clientIp(http), request.email());
        AccountLoginResponse out = accounts.login(request.email(), request.password());
        // Mint the refresh row + write the cookie only when the account_id is
        // present (it always is on a successful login — belt-and-braces null
        // check keeps the compiler and the audit both happy).
        if (out.account() != null && out.account().accountId() != null) {
            String plain = accounts.issueRefresh(out.account().accountId(), http.getHeader("User-Agent"), clientIp(http));
            writeAccountRefreshCookie(res, plain);
        }
        return out;
    }

    /**
     * Rotate the account refresh token and re-mint the access token.
     *
     * <p>Two accepted transports:
     * <ul>
     *   <li><b>Cookie</b> — web. Browser sends {@code ut_acct_rt} automatically;
     *       script cannot read or forge it (HttpOnly).</li>
     *   <li><b>JSON body</b> {@code {"refreshToken":"..."}} — mobile / any client
     *       without a cookie jar. Kept open per contract even though the current
     *       mobile app does not use it yet.</li>
     * </ul>
     *
     * <p>Rotation is unconditional: the presented row is deleted and a fresh
     * one issued, so cookie AND response body ALWAYS carry the NEW token. A
     * client that retries with the previous token gets 401.
     *
     * <p>Rate-limited per IP (60/min). Not per-email — the whole point of the
     * refresh path is that we do not yet know the email at request time
     * (opaque token in a cookie / body). This is a healthy budget for the
     * "browser fires refresh from N tabs on wake" case while still stopping
     * a runaway loop.
     */
    @PostMapping("/v1/accounts/auth/refresh")
    public AccountLoginResponse refresh(HttpServletRequest http, HttpServletResponse res) {
        rateLimiter.checkPerIp("accounts-auth-refresh", clientIp(http), 60);

        // Body takes precedence over cookie — same contract as the tenant-scoped
        // /v1/canonical-auth/refresh so a mobile client which one day mixes both
        // paths (cookie set by a WebView + explicit body from a native call) is
        // never ambiguous about which wins.
        String bodyToken = readRefreshTokenFromBody(http);
        String cookieToken = readRefreshCookie(http);
        String presented = bodyToken != null ? bodyToken : cookieToken;

        if (presented == null || presented.isBlank()) {
            // No credential presented at all. Clear any stale cookie so the
            // browser stops replaying it on every page load.
            clearAccountRefreshCookie(res);
            throw new org.springframework.web.server.ResponseStatusException(
                    HttpStatus.UNAUTHORIZED, "No refresh token supplied");
        }

        AccountLoginResponse out;
        try {
            out = accounts.refresh(presented);
        } catch (RuntimeException e) {
            // Expired / revoked / unknown. Kill the cookie so future reloads
            // stop hitting the refresh endpoint with a dead credential.
            clearAccountRefreshCookie(res);
            throw e;
        }

        // Rotation: mint a brand-new refresh token and rewrite the cookie in
        // this same response. Without this the cookie still holds the token we
        // just deleted, and the very next reload signs the user out.
        if (out.account() != null && out.account().accountId() != null) {
            String plain = accounts.issueRefresh(out.account().accountId(), http.getHeader("User-Agent"), clientIp(http));
            writeAccountRefreshCookie(res, plain);
        }
        return out;
    }

    /**
     * Sign out of the account portal: revoke the presented refresh row and
     * clear the cookie so a page reload cannot restore the session.
     *
     * <p>PermitAll: an expired access token must still be able to log out —
     * that is the moment users most want the button to work. The cookie IS
     * the credential; with no cookie the endpoint is a harmless no-op.
     */
    @PostMapping("/v1/accounts/auth/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest http, HttpServletResponse res) {
        String presented = readRefreshCookie(http);
        if (presented == null) presented = readRefreshTokenFromBody(http);
        if (presented != null) {
            try {
                accounts.revokeRefresh(presented);
            } catch (RuntimeException e) {
                // Already gone / never existed is a fine outcome for logout.
                log.debug("logout: account refresh could not be revoked ({})", e.getMessage());
            }
        }
        clearAccountRefreshCookie(res);
    }

    @GetMapping("/v1/accounts/me/workspaces")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public List<WorkspaceSummary> workspaces(@AuthenticationPrincipal Jwt jwt) {
        return accounts.workspaces(jwt);
    }

    @PostMapping("/v1/accounts/workspaces")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public SignupResponse createWorkspace(@AuthenticationPrincipal Jwt jwt,
                                          @Valid @RequestBody CreateWorkspaceRequest request) {
        return accounts.createWorkspace(jwt, request);
    }

    /**
     * "Enter Workspace" — exchange an account session for a workspace session.
     *
     * <p>Also writes the {@code ut_rt_<tenantId>} refresh cookie, exactly as
     * {@code CanonicalAuthController.login()} does for a direct workspace
     * password login. Without it the SSO-entered tab held its access token in
     * memory only, so a single page reload logged the user straight back out —
     * and worse, the cookie-less refresh used to fall back to whatever other
     * {@code ut_rt_*} cookie the browser had, minting a DIFFERENT workspace's
     * session inside this tab. Both were fixed together on 2026-08-22; this
     * half removes the trigger, the refresh handler removes the fallback.
     */
    @PostMapping("/v1/accounts/workspaces/session")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public WorkspaceSessionResponse session(@AuthenticationPrincipal Jwt jwt,
                                            @Valid @RequestBody WorkspaceSessionRequest request,
                                            HttpServletResponse res) {
        WorkspaceSessionResponse out = accounts.createWorkspaceSession(jwt, request.tenantId());
        if (out != null && out.auth() != null) {
            writeWorkspaceRefreshCookie(res, out.auth().tenantId(), out.auth().refreshToken());
        }
        return out;
    }

    /**
     * Mirror of {@code CanonicalAuthController.writeRefreshCookie} — the two
     * MUST stay byte-identical in name and attributes, because the refresh
     * endpoint that reads this cookie lives in that other controller. Cookie
     * names may not contain '-', so the UUID is written un-hyphenated.
     */
    private void writeWorkspaceRefreshCookie(HttpServletResponse res, UUID tenantId, String refreshToken) {
        if (res == null || tenantId == null || refreshToken == null || refreshToken.isBlank()) return;
        String name = WORKSPACE_RT_COOKIE_PREFIX + tenantId.toString().replace("-", "");
        res.addHeader("Set-Cookie", String.join("; ",
                name + "=" + refreshToken,
                "Max-Age=" + WORKSPACE_RT_COOKIE_MAX_AGE_SECONDS,
                "Path=/",
                "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    @GetMapping("/v1/workspace/context")
    @PreAuthorize("hasAuthority('workspace.context.read')")
    public WorkspaceSummary currentWorkspace(@AuthenticationPrincipal Jwt jwt) {
        return accounts.currentWorkspace(jwt);
    }

    @PostMapping("/v1/workspace/modules/{moduleKey}/request-upgrade")
    @PreAuthorize("hasAuthority('workspace.modules.buy')")
    public WorkspaceSummary requestUpgrade(@AuthenticationPrincipal Jwt jwt,
                                           @PathVariable String moduleKey) {
        return accounts.requestModuleUpgrade(jwt, moduleKey);
    }

    // ── cookie plumbing ──────────────────────────────────────────────────────

    /**
     * Persist the refresh token as an httpOnly cookie so a page reload can
     * restore the account session.
     *
     * <p>Attributes and why (mirrors CanonicalAuthController.writeRefreshCookie):
     * <ul>
     *   <li><b>HttpOnly</b> — script cannot read it, so an XSS bug cannot
     *       exfiltrate the long-lived credential. The short-lived access token
     *       deliberately stays in memory only, never in storage.</li>
     *   <li><b>Secure</b> — HTTPS only.</li>
     *   <li><b>Domain=.unifiedtree.com</b> — set by api.unifiedtree.com but
     *       must travel from the marketing site AND every workspace subdomain
     *       during the boot-time /refresh call.</li>
     *   <li><b>SameSite=Lax</b> — sufficient because api.unifiedtree.com and
     *       every {@code *.unifiedtree.com} page share the registrable domain;
     *       Lax still blocks genuinely cross-site sends (CSRF).</li>
     *   <li><b>Path=/</b> — every account endpoint must receive it (login on
     *       one subdomain, refresh on api, logout from anywhere).</li>
     * </ul>
     */
    private void writeAccountRefreshCookie(HttpServletResponse res, String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) return;
        res.addHeader("Set-Cookie", String.join("; ",
                RT_COOKIE_NAME + "=" + refreshToken,
                "Max-Age=" + RT_COOKIE_MAX_AGE_SECONDS,
                "Path=/",
                "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    private void clearAccountRefreshCookie(HttpServletResponse res) {
        res.addHeader("Set-Cookie", String.join("; ",
                RT_COOKIE_NAME + "=",
                "Max-Age=0", "Path=/", "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    private static String readRefreshCookie(HttpServletRequest req) {
        Cookie[] cookies = req.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (RT_COOKIE_NAME.equals(c.getName())
                    && c.getValue() != null && !c.getValue().isBlank()) {
                return c.getValue();
            }
        }
        return null;
    }

    /**
     * Read {@code {"refreshToken":"..."}} out of the body without touching
     * Spring's message converter — an empty body would otherwise trip the
     * converter and 500 before we could fall back to the cookie path.
     */
    private static String readRefreshTokenFromBody(HttpServletRequest req) {
        if (req.getContentLengthLong() == 0L) return null;
        String raw;
        try (BufferedReader r = req.getReader()) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[512];
            int n;
            while ((n = r.read(buf)) != -1) sb.append(buf, 0, n);
            raw = sb.toString();
        } catch (IOException e) {
            return null;
        }
        if (raw == null || raw.isBlank()) return null;
        try {
            RefreshRequest parsed = OBJECT_MAPPER.readValue(raw, RefreshRequest.class);
            if (parsed != null && parsed.refreshToken() != null && !parsed.refreshToken().isBlank()) {
                return parsed.refreshToken();
            }
        } catch (IOException ignored) {
            // Malformed / non-JSON body: fall back to cookie lookup rather
            // than 400ing. Cookie-based callers send no body at all.
        }
        return null;
    }

    public record RefreshRequest(String refreshToken) {}

    /**
     * Best-effort client-IP resolution. Prefers the leftmost address in
     * {@code X-Forwarded-For} (Cloud Run injects it), else the servlet's
     * {@code getRemoteAddr()}. Returns null on total failure so the limiter
     * simply skips the IP key rather than erroring out the login.
     */
    private static String clientIp(HttpServletRequest req) {
        if (req == null) return null;
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            String first = (comma > 0 ? xff.substring(0, comma) : xff).trim();
            if (!first.isEmpty()) return first;
        }
        return req.getRemoteAddr();
    }
}
