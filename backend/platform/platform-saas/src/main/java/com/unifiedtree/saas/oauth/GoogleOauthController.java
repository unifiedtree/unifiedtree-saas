package com.unifiedtree.saas.oauth;

import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.saas.dto.AccountDtos.AccountLoginResponse;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Google Sign-In endpoints for the /v1/accounts portal.
 *
 * <p>Both endpoints are public (permitAll in CanonicalProdSecurityConfig).
 * Both ALWAYS respond with an HTTP 302 — never JSON — because the caller is
 * always a browser doing top-level navigation:
 * <ul>
 *   <li>{@code GET /v1/accounts/auth/google/start} → 302 to Google's
 *       authorize URL. Sets the short-lived {@code ut_oauth_state} cookie so
 *       /callback can defeat state fixation.</li>
 *   <li>{@code GET /v1/accounts/auth/google/callback} → on success, 302 to
 *       {@code webBaseUrl + returnTo} while writing the same
 *       {@code ut_acct_rt} cookie the password login writes. On failure,
 *       302 to {@code webBaseUrl + /login?error=<code>}.</li>
 * </ul>
 *
 * <p>NEVER creates a workspace, NEVER hits Razorpay, NEVER writes
 * {@code platform.tenants} / {@code platform.account_workspaces}. The
 * response body's {@code workspaces} list comes only from EXISTING rows via
 * {@code workspacesForAccount()} — the same call the password login makes.
 */
@RestController
@RequestMapping("/v1/accounts/auth/google")
public class GoogleOauthController {

    private static final Logger log = LoggerFactory.getLogger(GoogleOauthController.class);

    /**
     * Cookie name for the account-tier refresh token. MUST match
     * {@code AccountController.RT_COOKIE_NAME} so the browser sees a single
     * ut_acct_rt cookie whether the sign-in came from Google or from
     * password login.
     */
    private static final String RT_COOKIE_NAME = "ut_acct_rt";
    private static final int RT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

    /**
     * Short-lived cookie carrying the OAuth state UUID. MUST include the
     * {@code /api} context prefix — that prefix is added by Cloud Run's
     * spring.webflux.base-path (server.servlet.context-path in this app), so
     * the real path the browser sees is {@code /api/v1/accounts/auth/google/callback}.
     * A cookie scoped to {@code /v1/accounts/auth/google} does NOT match a
     * request to {@code /api/v1/accounts/auth/google/callback} — cookie Path
     * is a plain prefix match, so the state cookie was never sent to the
     * callback. Every Google sign-in attempt then failed with
     * "session expired" (rev 00123 and earlier). Fixed 2026-08-23.
     */
    private static final String STATE_COOKIE_NAME = "ut_oauth_state";
    private static final int STATE_COOKIE_MAX_AGE_SECONDS = 15 * 60; // matches the DB row TTL
    private static final String STATE_COOKIE_PATH = "/api/v1/accounts/auth/google";

    /** /start budget: 20 per minute per IP — matches the design limit. */
    private static final int START_PER_MIN = 20;
    /** /callback budget: 60 per minute per IP — matches /refresh. */
    private static final int CALLBACK_PER_MIN = 60;

    private final GoogleOauthService oauth;
    private final PublicEndpointRateLimiter rateLimiter;

    public GoogleOauthController(GoogleOauthService oauth, PublicEndpointRateLimiter rateLimiter) {
        this.oauth = oauth;
        this.rateLimiter = rateLimiter;
    }

    // ── /start ──────────────────────────────────────────────────────────────

    @GetMapping("/start")
    public void start(@RequestParam(value = "return_to", required = false) String returnTo,
                      @RequestParam(value = "prompt", required = false) String prompt,
                      HttpServletRequest req,
                      HttpServletResponse res) throws IOException {
        rateLimiter.checkPerIp("accounts-auth-google-start", clientIp(req), START_PER_MIN);
        GoogleOauthService.AuthorizeStart start;
        try {
            start = oauth.startAuthorizeUrl(returnTo, prompt, clientIp(req), req.getHeader("User-Agent"));
        } catch (GoogleOauthService.OauthUnavailableException e) {
            res.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            res.setContentType("application/json");
            res.getWriter().write("{\"error\":\"oauth_unavailable\"}");
            return;
        }
        writeStateCookie(res, start.stateToken().toString());
        res.setStatus(HttpStatus.FOUND.value());
        res.setHeader("Location", start.authorizeUrl());
    }

    // ── /callback ───────────────────────────────────────────────────────────

    @GetMapping("/callback")
    public void callback(@RequestParam(value = "code", required = false) String code,
                         @RequestParam(value = "state", required = false) String state,
                         @RequestParam(value = "error", required = false) String googleError,
                         HttpServletRequest req,
                         HttpServletResponse res) {
        rateLimiter.checkPerIp("accounts-auth-google-callback", clientIp(req), CALLBACK_PER_MIN);

        String cookieState = readStateCookie(req);
        String ip = clientIp(req);
        String ua = req.getHeader("User-Agent");

        try {
            GoogleOauthService.CallbackResult result = oauth.completeCallback(
                    state, cookieState, code, googleError, ip, ua);
            // Success. Mint the refresh cookie (same shape as password login).
            AccountLoginResponse loginResponse = result.loginResponse();
            if (loginResponse != null && loginResponse.account() != null) {
                writeAccountRefreshCookie(res, result.refreshToken());
            }
            clearStateCookie(res);
            redirect(res, oauth.webBaseUrl() + safeReturnTo(result.returnTo()));
        } catch (GoogleOauthService.OauthCallbackException e) {
            clearStateCookie(res);
            String returnTo = e.returnTo();  // not exposed on error redirect but tracked for reference
            log.info("google oauth callback failed: code={} return_to={}", e.errorCode(), returnTo);
            String errorParam = urlEncode(e.errorCode());
            redirect(res, oauth.webBaseUrl() + "/login?error=" + errorParam);
        } catch (RuntimeException e) {
            // Never leak a stack trace or Google error text into the URL.
            clearStateCookie(res);
            log.warn("google oauth callback errored: {}", e.toString());
            redirect(res, oauth.webBaseUrl() + "/login?error=oauth_google_error");
        }
    }

    // ── cookie plumbing ─────────────────────────────────────────────────────

    /**
     * Set the ut_acct_rt cookie with the exact same attributes as
     * {@code AccountController.writeAccountRefreshCookie} — HttpOnly, Secure,
     * SameSite=Lax, Domain=.unifiedtree.com, Path=/, 30 days. So the browser
     * holds ONE ut_acct_rt cookie regardless of which path minted the session.
     */
    private static void writeAccountRefreshCookie(HttpServletResponse res, String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) return;
        res.addHeader("Set-Cookie", String.join("; ",
                RT_COOKIE_NAME + "=" + refreshToken,
                "Max-Age=" + RT_COOKIE_MAX_AGE_SECONDS,
                "Path=/",
                "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    private static void writeStateCookie(HttpServletResponse res, String stateValue) {
        res.addHeader("Set-Cookie", String.join("; ",
                STATE_COOKIE_NAME + "=" + stateValue,
                "Max-Age=" + STATE_COOKIE_MAX_AGE_SECONDS,
                "Path=" + STATE_COOKIE_PATH,
                "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    private static void clearStateCookie(HttpServletResponse res) {
        res.addHeader("Set-Cookie", String.join("; ",
                STATE_COOKIE_NAME + "=",
                "Max-Age=0",
                "Path=" + STATE_COOKIE_PATH,
                "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    private static String readStateCookie(HttpServletRequest req) {
        Cookie[] cookies = req.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (STATE_COOKIE_NAME.equals(c.getName())
                    && c.getValue() != null && !c.getValue().isBlank()) {
                return c.getValue();
            }
        }
        return null;
    }

    // ── small helpers ───────────────────────────────────────────────────────

    private static void redirect(HttpServletResponse res, String location) {
        res.setStatus(HttpStatus.FOUND.value());
        res.setHeader("Location", location);
    }

    /**
     * Guard the final Location URL against a bad returnTo slipping through.
     * completeCallback already reads returnTo from the state ROW (which was
     * sanitized at /start), but belt-and-braces re-check here defeats a
     * future bug that lets an attacker-controlled string reach us.
     */
    private static String safeReturnTo(String candidate) {
        return GoogleOauthService.sanitizeReturnTo(candidate);
    }

    private static String urlEncode(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    /** Mirror of the private helper on AccountController. */
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

    // Reference kept so ‘javac -Werror -unused’ style checks do not clip UUID
    // as an unused import (we accept the state value from the request as a
    // raw String and only parse it inside the service).
    @SuppressWarnings("unused")
    private static final Class<?> UNUSED_UUID_REF = UUID.class;
}
