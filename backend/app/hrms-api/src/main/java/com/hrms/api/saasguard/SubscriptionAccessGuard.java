package com.hrms.api.saasguard;

import com.unifiedtree.saas.billing.SubscriptionStanding;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.subscription.SubscriptionStateReconciler;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
import java.util.Arrays;
import java.util.List;
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
 * <p><b>Only the unpaid modules pause (owner rule, 6 Oct 2026; contract §2 with the HRMS lane).</b>
 * Once a subscription is past its grace (HALTED past grace_until, or PAST_DUE 7 days after the due
 * date once V144_1 is applied), only API calls to that subscription's modules ({@code modules[]},
 * mapped by {@link TenantModuleGuard#moduleForPath}) answer 402 {@code MODULE_PAUSED}; everything
 * else — sign-in, /me, business settings, billing, notifications — keeps working so the owner can
 * pay. Cancelled / expired subscriptions follow the same per-module rule.
 *
 * <p>402 body for a paused module: {@code code} "MODULE_PAUSED", {@code moduleKey}, {@code companyId}
 * (null until subscriptions are per company), {@code dueAmountInr}, {@code dueSince},
 * {@code graceEndedOn}, {@code canPay} (the caller holds workspace.billing.manage) and {@code message},
 * plus the older {@code error}/{@code status}/{@code graceExpiredAt} so older clients still show
 * their lapsed screen.
 *
 * <p>The rule itself ({@link #evaluate}, {@link #pauses}, {@link #GRACE}, the grandfather list) is
 * {@link SubscriptionStanding} in platform-saas, which the company entitlement answer
 * ({@code CompanyEntitlementService}) uses too: a lapsed subscription pauses the same modules in
 * HRMS, in the admin console and in Marketing.
 *
 * <p>Older 402 body shape (still sent for a missing ledger row):
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
            "/v1/workspace/plan",       // /plan/current + /setup-autopay/status MUST work for a
                                        // lapsed tenant — admin needs to see current state and
                                        // start a renewal from the same page
            "/v1/notifications",        // circular gate otherwise: the BILLING_OVER_CAP + renewal
                                        // warnings we send when a sub lapses are FETCHED via this
                                        // endpoint. Behind the guard, the customer never sees the
                                        // very notification telling them to renew (Anil 2026-08-23)
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
    /** Whether V144_1 (past_due_since) is applied; until then PAST_DUE never pauses (as before). */
    private final com.unifiedtree.saas.billing.BillingReminderSchema dueDateSchema;

    /** B1 FIX (audit 2026-08-15): fail-closed grandfather list. Any tenant whose
     *  UUID is on this list AND has no subscription row is granted access — that
     *  is the "legitimately-unbilled" bucket (Play reviewer, demo, pre-autopay
     *  customers). Everyone else with no subscription row is denied, because a
     *  missing ledger is now evidence of a bug (dropped row, failed provisioning
     *  clean-up) rather than a policy choice. Populated from
     *  {@code unifiedtree.subscription.grandfather-tenant-ids} in application.yml
     *  (comma-separated UUIDs); defaults to empty = fully fail-closed. */
    private final Set<UUID> grandfatheredTenantIds;

    /** What the last check with Razorpay for a business found, and when (epoch seconds). */
    enum CheckState { IN_FLIGHT, ANSWERED, UNREACHABLE }
    record Check(long at, CheckState state) {}

    /**
     * Per-business check with Razorpay, at most one per DENY_CACHE_TTL_SECONDS. The slot is CLAIMED
     * (IN_FLIGHT) before Razorpay is asked, so a page load of five calls asks once (review 7 Oct, P4);
     * the others go through while the answer is awaited (never paused on an unconfirmed lapse).
     */
    private final ConcurrentHashMap<UUID, Check> checks = new ConcurrentHashMap<>();

    /** The guard's own Razorpay client: short timeouts, so a paused request never waits 20 s (P4). */
    static final java.time.Duration CHECK_CONNECT_TIMEOUT = java.time.Duration.ofSeconds(2);
    static final java.time.Duration CHECK_READ_TIMEOUT = java.time.Duration.ofSeconds(3);
    private final RazorpayClient quickRazorpay;

    /**
     * How long past the pause point Razorpay being unreachable still lets requests through. After that
     * a business that hasn't paid is paused even while Razorpay can't be asked (logged as an alert).
     */
    static final java.time.Duration FAIL_OPEN_CAP = java.time.Duration.ofHours(48);

    @Autowired
    public SubscriptionAccessGuard(JdbcTemplate jdbc,
                                   RazorpayClient razorpay,
                                   SubscriptionStateReconciler reconciler,
                                   @Value("${unifiedtree.subscription.grandfather-tenant-ids:}") String grandfatherCsv) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.reconciler = reconciler;
        this.quickRazorpay = razorpay == null ? null : razorpay.withTimeouts(CHECK_CONNECT_TIMEOUT, CHECK_READ_TIMEOUT);
        this.dueDateSchema = new com.unifiedtree.saas.billing.BillingReminderSchema(jdbc);
        this.grandfatheredTenantIds = parseGrandfatherList(grandfatherCsv);
        if (!this.grandfatheredTenantIds.isEmpty()) {
            log.info("SubscriptionAccessGuard grandfather list loaded ({} tenant(s)): {}",
                    this.grandfatheredTenantIds.size(), this.grandfatheredTenantIds);
        }
    }

    private static Set<UUID> parseGrandfatherList(String csv) {
        return SubscriptionStanding.parseGrandfathered(csv);
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
        // B1 FIX (audit 2026-08-15): FAIL-CLOSED for missing subscription rows.
        // Previously we fell open here to accommodate grandfathered/pre-autopay
        // tenants and the reviewer demo, which also silently papered over any
        // bug that dropped a paying customer's ledger row. Now: allow only
        // tenants on the operator-maintained grandfather list; everyone else
        // with no subscription row is denied with the standard 402 body. The
        // list ships in application-canonical-prod.yml as
        // 'unifiedtree.subscription.grandfather-tenant-ids' (comma-separated).
        if (sub == null) {
            if (grandfatheredTenantIds.contains(tenantId)) return true;
            log.info("subscription-guard BLOCK (no ledger row, not grandfathered)  tenant={} path={}",
                    tenantId, path);
            response.setStatus(HttpStatus.PAYMENT_REQUIRED.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write(
                    "{\"error\":\"subscription_lapsed\",\"status\":\"NO_SUBSCRIPTION\","
                            + "\"graceExpiredAt\":null,"
                            + "\"message\":\"No active subscription found for this workspace. "
                            + "Please contact support if you believe this is an error.\"}");
            return false;
        }

        Instant now = Instant.now();
        AccessDecision d = evaluate(sub, now);
        if (d.allowed()) return true;

        // Only the unpaid modules pause: a call that needs no module (sign-in, /me, settings,
        // users, notifications…) or a module this subscription doesn't cover goes through —
        // decided first, so those calls never reach Razorpay.
        String moduleKey = TenantModuleGuard.moduleForPath(path);
        if (!pauses(sub, moduleKey)) return true;

        // CHECK WITH RAZORPAY BEFORE PAUSING (owner, 7 Oct 2026; client's ask of 2026-08-07: "we
        // should not stop giving access even though we got received amount"). A lost / delayed
        // subscription.charged webhook would leave OUR ledger PAST_DUE or HALTED while Razorpay has
        // the customer paid. So before pausing for non-payment we ask Razorpay; when it says paid,
        // the shared reconciler promotes our row to ACTIVE and the request goes through. When
        // Razorpay can't be reached we do NOT pause (a paying business must never be paused); we
        // retry after DENY_CACHE_TTL_SECONDS. Once per tenant per DENY_CACHE_TTL_SECONDS either way,
        // so a busy page can't hammer Razorpay. Terminal statuses (CANCELLED / COMPLETED /
        // EXPIRED) are not non-payment and are never auto-restored.
        if (("HALTED".equals(sub.status()) || "PAST_DUE".equals(sub.status()))
                && sub.razorpaySubscriptionId() != null
                && !sub.razorpaySubscriptionId().isBlank()
                && quickRazorpay != null && reconciler != null) {
            Instant pausePoint = pausePoint(sub);
            boolean capped = pausePoint != null && now.isAfter(pausePoint.plus(FAIL_OPEN_CAP));
            Check claimed = new Check(now.getEpochSecond(), CheckState.IN_FLIGHT);
            Check current = checks.compute(tenantId, (k, prev) ->
                    prev == null || now.getEpochSecond() - prev.at() >= DENY_CACHE_TTL_SECONDS ? claimed : prev);
            if (current != claimed) {
                // Asked within the last minute (or being asked right now by another request).
                if (current.state() == CheckState.ANSWERED) {
                    // Razorpay said not paid (a "paid" answer made our row ACTIVE, so we'd not be here).
                } else if (!capped) {
                    return true;   // being asked, or couldn't be asked: never pause on an unconfirmed lapse
                }
            } else {
                switch (askRazorpay(tenantId, sub)) {
                    case PAID -> {
                        checks.put(tenantId, new Check(now.getEpochSecond(), CheckState.ANSWERED));
                        return true;
                    }
                    case UNPAID -> checks.put(tenantId, new Check(now.getEpochSecond(), CheckState.ANSWERED));
                    case REFUSED -> checks.put(tenantId, new Check(now.getEpochSecond(), CheckState.ANSWERED));
                    case UNREACHABLE -> {
                        checks.put(tenantId, new Check(now.getEpochSecond(), CheckState.UNREACHABLE));
                        if (!capped) {
                            log.warn("subscription-guard NOT PAUSING (Razorpay unreachable, can't confirm non-payment)  tenant={} status={}",
                                    tenantId, sub.status());
                            return true;
                        }
                        log.error("SUBSCRIPTION_GUARD_FAIL_OPEN_CAPPED tenant={} status={} pausePoint={} : Razorpay still unreachable "
                                + "{} past the pause point; pausing", tenantId, sub.status(), pausePoint, FAIL_OPEN_CAP);
                    }
                }
            }
        }

        log.info("subscription-guard MODULE_PAUSED  tenant={} status={} module={} graceUntil={} path={}",
                tenantId, sub.status(), moduleKey, sub.graceUntil(), path);

        response.setStatus(HttpStatus.PAYMENT_REQUIRED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(pausedBody(sub, d, moduleKey, now, canPay(auth)));
        return false;
    }

    /** Whether this subscription's lapse pauses this module (no module = never; no module list = all). */
    static boolean pauses(SubStatus sub, String moduleKey) {
        return SubscriptionStanding.pauses(sub.modules(), moduleKey);
    }

    private static boolean canPay(Authentication auth) {
        return auth.getAuthorities().stream().map(a -> a.getAuthority())
                .anyMatch(a -> "workspace.billing.manage".equals(a) || "*".equals(a));
    }

    /** The 402 MODULE_PAUSED body (escapes every string it interpolates). */
    static String pausedBody(SubStatus sub, AccessDecision d, String moduleKey, Instant now, boolean canPay) {
        java.time.ZoneId ist = java.time.ZoneId.of("Asia/Kolkata");
        Instant graceEnd = sub.graceUntil() != null ? sub.graceUntil()
                : sub.pastDueSince() != null ? sub.pastDueSince().plus(GRACE) : null;
        return "{\"code\":\"MODULE_PAUSED\",\"error\":\"subscription_lapsed\","
                + "\"status\":\"" + escape(sub.status()) + "\","
                + "\"graceExpiredAt\":" + (graceEnd == null ? "null" : "\"" + escape(graceEnd.toString()) + "\"") + ","
                + "\"moduleKey\":\"" + escape(moduleKey) + "\","
                + "\"companyId\":null,"
                + "\"dueAmountInr\":" + (sub.amountInr() == null ? "null" : sub.amountInr().stripTrailingZeros().toPlainString()) + ","
                + "\"dueSince\":" + (sub.pastDueSince() == null ? "null" : "\"" + sub.pastDueSince().atZone(ist).toLocalDate() + "\"") + ","
                + "\"graceEndedOn\":" + (graceEnd == null ? "null" : "\"" + graceEnd.atZone(ist).toLocalDate() + "\"") + ","
                + "\"canPay\":" + canPay + ","
                + "\"message\":\"" + escape(d.reason()) + "\"}";
    }

    enum Answer { PAID, UNPAID, REFUSED, UNREACHABLE }

    /**
     * Asks Razorpay about this subscription (short timeouts) and saves what it says through the shared
     * reconciler. PAID when our row is now in good standing; UNPAID when Razorpay answered and it isn't;
     * REFUSED when Razorpay said no (4xx: wrong or rotated keys, unknown subscription) or the gateway
     * isn't configured — a fault on our side, logged as an alert, and the business IS paused (it would
     * otherwise never be paused); UNREACHABLE for no answer, a timeout or a 5xx.
     */
    private Answer askRazorpay(UUID tenantId, SubStatus sub) {
        RazorpayClient.SubscriptionView view;
        try {
            view = quickRazorpay.fetchSubscription(sub.razorpaySubscriptionId());
        } catch (RazorpayClient.Refused e) {
            log.error("SUBSCRIPTION_GUARD_RAZORPAY_REFUSED tenant={} sub={} razorpayStatus={} : {} — pausing; check the Razorpay keys",
                    tenantId, sub.razorpaySubscriptionId(), e.razorpayStatus(), e.getReason());
            return Answer.REFUSED;
        } catch (org.springframework.web.server.ResponseStatusException e) {
            if (e.getStatusCode().value() == HttpStatus.SERVICE_UNAVAILABLE.value()) {
                log.error("SUBSCRIPTION_GUARD_RAZORPAY_REFUSED tenant={} sub={} : payment gateway not configured — pausing",
                        tenantId, sub.razorpaySubscriptionId());
                return Answer.REFUSED;
            }
            return Answer.UNREACHABLE;
        } catch (RuntimeException e) {
            return Answer.UNREACHABLE;
        }
        String upstream = applyUnbound(sub.razorpaySubscriptionId(), view);
        if (upstream == null) return Answer.UNREACHABLE;
        // Re-read our ledger: the reconciler may have promoted us to ACTIVE.
        SubStatus fresh = loadStatus(tenantId);
        if (fresh != null && evaluate(fresh, Instant.now()).allowed()) {
            log.info("subscription-guard AUTO-RESTORE  tenant={} was={} now={} razorpay={}",
                    tenantId, sub.status(), fresh.status(), upstream);
            return Answer.PAID;
        }
        return Answer.UNPAID;
    }

    /**
     * The reconciler's writes with the request's tenant UNBOUND. On a tenant-bound connection
     * TenantAwareDataSource turns auto-commit off for SET LOCAL, so without a transaction the
     * reconciler's UPDATE (paid -> ACTIVE) was never committed and the re-read still saw the old
     * status: a paying business stayed paused (review 7 Oct 2026, live probe P1). platform.subscriptions
     * has no row-level security, so unbound statements auto-commit one by one, and no connection is
     * held while Razorpay is asked (it is asked before this).
     */
    private String applyUnbound(String razorpaySubscriptionId, RazorpayClient.SubscriptionView view) {
        UUID bound = TenantContext.getTenantId();
        TenantContext.clear();
        try {
            return reconciler.applyFetched(razorpaySubscriptionId, view);
        } catch (RuntimeException e) {
            log.warn("subscription-guard could not save Razorpay's answer for {}: {}", razorpaySubscriptionId, e.getMessage());
            return null;
        } finally {
            if (bound != null) TenantContext.setTenantId(bound);
        }
    }

    /** When this subscription's access pauses: the grace end (grace_until, or due date + 7 days). */
    private static Instant pausePoint(SubStatus sub) {
        return sub.graceUntil() != null ? sub.graceUntil()
                : sub.pastDueSince() != null ? sub.pastDueSince().plus(GRACE) : null;
    }

    // -- decision -------------------------------------------------------------

    /** Grace after the due date (owner rule, 6 Oct 2026) — {@link SubscriptionStanding#GRACE}. */
    static final java.time.Duration GRACE = SubscriptionStanding.GRACE;

    static AccessDecision evaluate(SubStatus sub, Instant now) {
        SubscriptionStanding.Decision d =
                SubscriptionStanding.evaluate(sub.status(), sub.graceUntil(), sub.pastDueSince(), now);
        return new AccessDecision(d.allowed(), d.reason());
    }

    // -- DB -------------------------------------------------------------------

    private SubStatus loadStatus(UUID tenantId) {
        // Newest row wins if there are multiple (shouldn't happen — one active
        // subscription per tenant — but be safe on ORDER BY).
        // razorpay_subscription_id included so the guard can double-check
        // with Razorpay before locking out a HALTED-past-grace customer.
        boolean dueDates = dueDateSchema.ready();
        try {
            return jdbc.queryForObject("""
                    SELECT status, grace_until, razorpay_subscription_id, modules, amount_inr,
                           """ + (dueDates ? "past_due_since" : "NULL::timestamptz AS past_due_since") + """

                      FROM platform.subscriptions
                     WHERE tenant_id = ?
                     ORDER BY updated_at DESC NULLS LAST, created_at DESC
                     LIMIT 1
                    """, (rs, n) -> {
                Timestamp t = rs.getTimestamp("grace_until");
                Timestamp due = rs.getTimestamp("past_due_since");
                java.sql.Array arr = rs.getArray("modules");
                List<String> modules = arr == null ? List.of() : Arrays.asList((String[]) arr.getArray());
                return new SubStatus(
                        rs.getString("status"),
                        t == null ? null : t.toInstant(),
                        rs.getString("razorpay_subscription_id"),
                        modules,
                        rs.getBigDecimal("amount_inr"),
                        due == null ? null : due.toInstant());
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

    public record SubStatus(String status, Instant graceUntil, String razorpaySubscriptionId,
                            List<String> modules, java.math.BigDecimal amountInr, Instant pastDueSince) {
        /** Convenience for tests that only care about status + grace. */
        public SubStatus(String status, Instant graceUntil) { this(status, graceUntil, null, List.of(), null, null); }
    }

    public record AccessDecision(boolean allowed, String reason) {
        static AccessDecision allow() { return new AccessDecision(true, null); }
        static AccessDecision deny(String reason) { return new AccessDecision(false, reason); }
    }
}
