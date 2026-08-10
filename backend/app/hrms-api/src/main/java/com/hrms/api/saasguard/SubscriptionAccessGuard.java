package com.hrms.api.saasguard;

import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.subscription.SubscriptionStateReconciler;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.util.concurrent.ConcurrentHashMap;

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

    /** After a HALTED-past-grace guard-check has verified with Razorpay that
     *  the customer really is unpaid, cache the deny for this many seconds so
     *  a rapid burst of requests (e.g. a browser polling every 5s) does not
     *  hammer Razorpay's API. Reset the moment onActive lands or an admin
     *  re-mandates. Short enough that a genuine "just paid via UPI" is
     *  restored within a minute. */
    private static final long DENY_CACHE_TTL_SECONDS = 60;

    private final JdbcTemplate jdbc;
    /** Optional deps — the guard degrades gracefully to today's behavior if
     *  either is missing (the constructor injection makes them nullable so
     *  tests / older build wiring don't have to provide them). */
    private final RazorpayClient razorpay;
    private final SubscriptionStateReconciler reconciler;

    /** Per-tenant recent-deny cache: tenantId -> epoch-seconds-of-last-check.
     *  ConcurrentHashMap is fine; the guard runs on the request thread, no
     *  cross-request sharing beyond the map itself. */
    private final ConcurrentHashMap<UUID, Long> recentDenyCache = new ConcurrentHashMap<>();

    @Autowired
    public SubscriptionAccessGuard(JdbcTemplate jdbc,
                                   RazorpayClient razorpay,
                                   SubscriptionStateReconciler reconciler) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.reconciler = reconciler;
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

        Instant now = Instant.now();
        AccessDecision d = evaluate(sub, now);
        if (d.allowed()) return true;

        // SAFETY CHECK — before writing 402, if we can talk to Razorpay
        // verify the customer really is unpaid. Client's explicit ask
        // (2026-08-07): "we should not stop giving access even though we
        // got received amount". Motivation: a lost / delayed subscription.charged
        // webhook would leave OUR ledger in HALTED past grace while Razorpay
        // has the customer as ACTIVE. Without this check, we'd 402 a paying
        // customer. With it, we detect the mismatch, promote our row to
        // ACTIVE via the shared reconciler, and let the request through.
        //
        // Only fires for HALTED subscriptions with a razorpay_subscription_id
        // and only once every DENY_CACHE_TTL_SECONDS per tenant so a hammered
        // 402 loop can't hammer Razorpay too. Terminal statuses (CANCELLED /
        // COMPLETED / EXPIRED) are NEVER auto-restored — a customer who
        // legitimately cancelled must re-subscribe.
        if ("HALTED".equals(sub.status())
                && sub.razorpaySubscriptionId() != null
                && !sub.razorpaySubscriptionId().isBlank()
                && razorpay != null && reconciler != null
                && !recentlyChecked(tenantId, now)) {
            String upstream = reconciler.reconcileFromRazorpay(sub.razorpaySubscriptionId(), razorpay);
            recentDenyCache.put(tenantId, now.getEpochSecond());
            // Re-read our ledger — reconcileFromRazorpay may have promoted us
            // to ACTIVE if Razorpay says the charge went through.
            SubStatus fresh = loadStatus(tenantId);
            if (fresh != null) {
                AccessDecision d2 = evaluate(fresh, now);
                if (d2.allowed()) {
                    log.info("subscription-guard AUTO-RESTORE  tenant={} was={} now={} razorpay={}",
                            tenantId, sub.status(), fresh.status(), upstream);
                    return true;
                }
            }
        }

        log.info("subscription-guard BLOCK  tenant={} status={} graceUntil={} path={}",
                tenantId, sub.status(), sub.graceUntil(), path);

        response.setStatus(HttpStatus.PAYMENT_REQUIRED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        // Escape every string interpolated into the JSON body — status is a
        // controlled DB enum today, but future refactors mustn't create a
        // silent JSON-injection foot-cannon by echoing a fresh field raw.
        response.getWriter().write(
                "{\"error\":\"subscription_lapsed\",\"status\":\"" + escape(sub.status()) + "\","
                        + (sub.graceUntil() == null
                            ? "\"graceExpiredAt\":null,"
                            : "\"graceExpiredAt\":\"" + escape(sub.graceUntil().toString()) + "\",")
                        + "\"message\":\"" + escape(d.reason()) + "\"}");
        return false;
    }

    private boolean recentlyChecked(UUID tenantId, Instant now) {
        Long last = recentDenyCache.get(tenantId);
        return last != null && (now.getEpochSecond() - last) < DENY_CACHE_TTL_SECONDS;
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
            case "CANCELLED", "EXPIRED", "COMPLETED" -> {
                // Honour whatever period the customer paid for. onCancelled
                // stamps grace_until = current_period_end (falls back to now+3d
                // if there was no period end, e.g. mandate deleted mid-trial),
                // so a cancel on day 20 of a paid month keeps working through
                // the rest of that month.
                if (sub.graceUntil() != null && sub.graceUntil().isAfter(now)) {
                    yield AccessDecision.allow();
                }
                String msg = switch (sub.status()) {
                    case "CANCELLED" -> "This subscription was cancelled and the paid period has ended. "
                                      + "Start a new one to restore access.";
                    case "EXPIRED"   -> "This subscription has expired. Start a new one to restore access.";
                    default          -> "This subscription completed its billing cycles. Start a new one to continue.";
                };
                yield AccessDecision.deny(msg);
            }
            default          -> AccessDecision.allow();     // unknown status: fail-open (never worse than today)
        };
    }

    // -- DB -------------------------------------------------------------------

    private SubStatus loadStatus(UUID tenantId) {
        // Newest row wins if there are multiple (shouldn't happen — one active
        // subscription per tenant — but be safe on ORDER BY).
        // razorpay_subscription_id included so the guard can double-check
        // with Razorpay before locking out a HALTED-past-grace customer.
        try {
            return jdbc.queryForObject("""
                    SELECT status, grace_until, razorpay_subscription_id
                      FROM platform.subscriptions
                     WHERE tenant_id = ?
                     ORDER BY updated_at DESC NULLS LAST, created_at DESC
                     LIMIT 1
                    """, (rs, n) -> {
                Timestamp t = rs.getTimestamp("grace_until");
                return new SubStatus(
                        rs.getString("status"),
                        t == null ? null : t.toInstant(),
                        rs.getString("razorpay_subscription_id"));
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
        // Match on segment boundaries so /v1/subscription does NOT accidentally
        // allow /v1/subscriptions (which doesn't exist today, but might tomorrow
        // as a per-tenant subscriptions listing that ought to be gated).
        for (String prefix : ALWAYS_ALLOWED_PREFIXES) {
            if (path.equals(prefix) || path.startsWith(prefix + "/")) return true;
        }
        return false;
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    // -- records --------------------------------------------------------------

    public record SubStatus(String status, Instant graceUntil, String razorpaySubscriptionId) {
        /** Convenience for tests that only care about status + grace. */
        public SubStatus(String status, Instant graceUntil) { this(status, graceUntil, null); }
    }

    public record AccessDecision(boolean allowed, String reason) {
        static AccessDecision allow() { return new AccessDecision(true, null); }
        static AccessDecision deny(String reason) { return new AccessDecision(false, reason); }
    }
}
