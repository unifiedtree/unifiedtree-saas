package com.hrms.api.saas;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * Blocks workspace API access when the tenant's subscription is HALTED past
 * its 7-day grace window, or terminally CANCELLED / EXPIRED / COMPLETED.
 *
 * <p>Signal: reads the tenant's most-recent platform.subscriptions row.
 * State machine:
 * <ul>
 *   <li>TRIALING / ACTIVE / PAST_DUE / PAUSED  → allow (payment is on track
 *       or Razorpay is retrying)</li>
 *   <li>HALTED and grace_until &gt; now()      → allow (7-day grace window)</li>
 *   <li>HALTED and grace_until &lt;= now()     → 402 (grace expired)</li>
 *   <li>CANCELLED / EXPIRED / COMPLETED        → 402 (terminal)</li>
 *   <li>no subscription row at all             → allow (grandfathered tenants
 *       predating the autopay rollout, plus the Play-reviewer tenant)</li>
 * </ul>
 *
 * <p>Login and billing endpoints are ALWAYS allowed so a locked-out user can
 * still sign in and see the "your subscription has lapsed, please pay to
 * restore" screen (rendered by the workspace app when it sees 402).
 *
 * <p>402 body shape (frontend-detectable):
 * <pre>{
 *   "error": "subscription_lapsed",
 *   "status": "HALTED",
 *   "graceExpiredAt": "2026-08-15T00:00:00Z",
 *   "message": "Your subscription payment failed and the grace period ended..."
 * }</pre>
 */
@Component
public class SubscriptionAccessGuard implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionAccessGuard.class);

    private static final UUID PLATFORM_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000000");

    /** Paths always allowed even for a lapsed tenant — the user must be able to
     *  log in, poll workspace status, view billing, and cancel their subscription
     *  to know what's happening / restore access. */
    private static final Set<String> ALWAYS_ALLOWED_PREFIXES = Set.of(
            "/actuator",
            "/v1/public",
            "/v1/webhooks",
            "/v1/auth",
            "/v1/canonical-auth",
            "/v1/accounts",             // account-level (JWT is account-scoped, not tenant)
            "/v1/platform",
            "/v1/billing",              // future: renew-payment endpoints
            "/v1/subscription",         // future: cancel / update-mandate endpoints
            "/v1/workspace/context",    // workspace app calls this on load to detect state
            "/v3/api-docs",
            "/swagger-ui"
    );

    private final JdbcTemplate jdbc;

    public SubscriptionAccessGuard(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        String path = normalizedPath(request);
        if (isAlwaysAllowed(path)) return true;

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) return true;

        String tenantClaim = jwt.getClaimAsString("tenant_id");
        if (tenantClaim == null || tenantClaim.isBlank()) return true;

        UUID tenantId;
        try { tenantId = UUID.fromString(tenantClaim); }
        catch (IllegalArgumentException e) { return true; }
        if (PLATFORM_TENANT_ID.equals(tenantId)) return true;

        SubStatus sub = loadStatus(tenantId);
        if (sub == null) return true;   // grandfathered: no subscription row, no gating

        AccessDecision d = evaluate(sub, Instant.now());
        if (d.allowed()) return true;

        log.info("subscription-guard BLOCK  tenant={} status={} graceUntil={} path={}",
                tenantId, sub.status(), sub.graceUntil(), path);

        response.setStatus(HttpStatus.PAYMENT_REQUIRED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(
                "{\"error\":\"subscription_lapsed\",\"status\":\"" + sub.status() + "\","
                        + (sub.graceUntil() == null
                            ? "\"graceExpiredAt\":null,"
                            : "\"graceExpiredAt\":\"" + sub.graceUntil().toString() + "\",")
                        + "\"message\":\"" + escape(d.reason()) + "\"}");
        return false;
    }

    // -- decision -------------------------------------------------------------

    static AccessDecision evaluate(SubStatus sub, Instant now) {
        return switch (sub.status()) {
            case "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "GRACE" ->
                    AccessDecision.allow();
            case "HALTED" -> {
                if (sub.graceUntil() != null && sub.graceUntil().isAfter(now)) {
                    yield AccessDecision.allow();       // still inside grace
                }
                yield AccessDecision.deny(
                        "Your subscription payment failed and the 7-day grace period ended. "
                      + "Renew your mandate to restore access.");
            }
            case "CANCELLED" -> AccessDecision.deny("This subscription was cancelled. Start a new one to restore access.");
            case "EXPIRED"   -> AccessDecision.deny("This subscription has expired. Start a new one to restore access.");
            case "COMPLETED" -> AccessDecision.deny("This subscription completed its billing cycles. Start a new one to continue.");
            default          -> AccessDecision.allow();     // unknown status: fail-open (never worse than today)
        };
    }

    // -- DB -------------------------------------------------------------------

    private SubStatus loadStatus(UUID tenantId) {
        // Newest row wins if there are multiple (shouldn't happen — one active
        // subscription per tenant — but be safe on ORDER BY).
        try {
            return jdbc.queryForObject("""
                    SELECT status, grace_until FROM platform.subscriptions
                     WHERE tenant_id = ?
                     ORDER BY updated_at DESC NULLS LAST, created_at DESC
                     LIMIT 1
                    """, (rs, n) -> {
                Timestamp t = rs.getTimestamp("grace_until");
                return new SubStatus(rs.getString("status"), t == null ? null : t.toInstant());
            }, tenantId);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    // -- helpers --------------------------------------------------------------

    private static String normalizedPath(HttpServletRequest request) {
        String p = request.getRequestURI();
        String ctx = request.getContextPath();
        if (ctx != null && !ctx.isBlank() && p.startsWith(ctx)) p = p.substring(ctx.length());
        return p == null ? "" : p;
    }

    private static boolean isAlwaysAllowed(String path) {
        for (String prefix : ALWAYS_ALLOWED_PREFIXES) {
            if (path.startsWith(prefix)) return true;
        }
        return false;
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    // -- records --------------------------------------------------------------

    public record SubStatus(String status, Instant graceUntil) {}

    public record AccessDecision(boolean allowed, String reason) {
        static AccessDecision allow() { return new AccessDecision(true, null); }
        static AccessDecision deny(String reason) { return new AccessDecision(false, reason); }
    }
}
