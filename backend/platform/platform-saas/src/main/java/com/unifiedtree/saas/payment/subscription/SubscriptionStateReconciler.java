package com.unifiedtree.saas.payment.subscription;

import com.fasterxml.jackson.databind.JsonNode;
import com.unifiedtree.saas.event.SubscriptionHaltedEvent;
import com.unifiedtree.saas.payment.RazorpayClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

/**
 * Central write-path for {@code platform.subscriptions} row-state changes
 * driven by Razorpay signals. Exists so the THREE consumers of that state
 * — the webhook controller, the request-time access guard, and the hourly
 * reconciliation cron — cannot drift in what they write for the same event.
 *
 * <p>Every mutator carries a {@code WHERE status NOT IN (...)} guard on
 * terminal transitions so a late-arriving webhook (Razorpay retries for 24h)
 * cannot resurrect a legitimately CANCELLED or COMPLETED subscription back
 * to ACTIVE. Only {@link #onCompleted} and {@link #onCancelled} may write
 * terminal states, and neither transitions FROM another terminal state.
 *
 * <p>All mutators also stamp {@code last_reconciled_at + last_razorpay_status}
 * so the reconciliation job can cheaply pick oldest-un-reconciled rows and
 * ops can see when we last heard from Razorpay for a given subscription.
 */
@Service
public class SubscriptionStateReconciler {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionStateReconciler.class);

    /** Statuses we refuse to transition AWAY from — terminal on our side. */
    private static final String TERMINAL_STATUSES_SQL_LIST =
            "'CANCELLED','COMPLETED','EXPIRED'";

    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;
    /** Optional — used only as a fallback in {@link #onCancelled} when our
     *  DB has no {@code current_period_end}/{@code trial_ends_at} to base
     *  grace on. Nullable so unit tests / older wiring don't have to
     *  provide it; if absent, the SQL falls back to a 3-day courtesy grace. */
    private final com.unifiedtree.saas.payment.RazorpayClient razorpay;

    // @Autowired is REQUIRED with multiple public ctors on a Spring bean —
    // otherwise Spring picks the no-arg heuristic and fails with
    // "No default constructor found" (caught live on rev 85 at boot 2026-08-10).
    @org.springframework.beans.factory.annotation.Autowired
    public SubscriptionStateReconciler(JdbcTemplate jdbc, ApplicationEventPublisher events,
                                       org.springframework.beans.factory.ObjectProvider<
                                           com.unifiedtree.saas.payment.RazorpayClient> razorpayProvider) {
        this.jdbc = jdbc;
        this.events = events;
        this.razorpay = razorpayProvider == null ? null : razorpayProvider.getIfAvailable();
    }

    /** Test / legacy 2-arg constructor. No Razorpay fallback available. */
    public SubscriptionStateReconciler(JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
        this.razorpay = null;
    }

    // -- state mutators --------------------------------------------------------

    /**
     * Subscription is active + charged. Clears halted_at AND grace_until so a
     * later halt cycle starts a fresh 7-day window (the previous COALESCE
     * pattern on grace_until could leave a stale expired-grace value that
     * silently locks a bouncing customer out).
     *
     * <p>next_charge_at and payment_method both use COALESCE — Razorpay
     * doesn't always report them on every event (e.g. a subscription.updated
     * carries the payload but may omit fields), so a NULL from optLong or an
     * empty string from optText must NOT wipe the stored value. The optText
     * helper below normalises empty to null so COALESCE actually keeps the
     * existing column instead of overwriting it with "".
     */
    public void onActive(String subscriptionId, JsonNode subNode) {
        Long currentEnd = optLong(subNode, "current_end");
        Long chargeAt   = optLong(subNode, "charge_at");
        String method   = optText(subNode, "payment_method");
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status                = 'ACTIVE',
                    halted_at             = NULL,
                    grace_until           = NULL,
                    current_period_end    = COALESCE(to_timestamp(?), current_period_end),
                    next_charge_at        = COALESCE(to_timestamp(?), next_charge_at),
                    payment_method        = COALESCE(?, payment_method),
                    last_reconciled_at    = now(),
                    last_razorpay_status  = 'active',
                    reconcile_error       = NULL,
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status NOT IN (""" + TERMINAL_STATUSES_SQL_LIST + """
                                                                    )
                """, currentEnd, chargeAt, method, subscriptionId);
        if (rows == 0) {
            log.info("onActive({}) — no ledger row (or already terminal); noop", subscriptionId);
        } else {
            log.info("Subscription {} -> ACTIVE (nextCharge={}, method={}, grace cleared)",
                    subscriptionId, chargeAt, method);
        }
    }

    public void onPending(String subscriptionId, JsonNode subNode) {
        Long chargeAt = optLong(subNode, "charge_at");
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status                = 'PAST_DUE',
                    next_charge_at        = COALESCE(to_timestamp(?), next_charge_at),
                    last_reconciled_at    = now(),
                    last_razorpay_status  = 'pending',
                    reconcile_error       = NULL,
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status NOT IN (""" + TERMINAL_STATUSES_SQL_LIST + """
                                                                    )
                """, chargeAt, subscriptionId);
        if (rows > 0) log.info("Subscription {} -> PAST_DUE (Razorpay retrying charge)", subscriptionId);
    }

    /**
     * Razorpay exhausted its own retries. Set HALTED and START the 7-day
     * grace window. Grace is set unconditionally here (not COALESCE) — a
     * bouncing subscription that goes ACTIVE (grace cleared) then HALTED
     * again gets a fresh 7-day window each time.
     *
     * <p><b>Transition guard:</b> the WHERE clause also excludes rows already
     * in HALTED so this method's return value ({@code true} when a real
     * transition happened) can gate the SubscriptionHaltedEvent publish —
     * otherwise the hourly reconciliation cron + inline access-guard would
     * re-fire the notification every sweep.
     */
    public boolean onHalted(String subscriptionId) {
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status                = 'HALTED',
                    halted_at             = COALESCE(halted_at, now()),
                    grace_until           = now() + interval '7 days',
                    last_reconciled_at    = now(),
                    last_razorpay_status  = 'halted',
                    reconcile_error       = NULL,
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status <> 'HALTED'
                   AND status NOT IN (""" + TERMINAL_STATUSES_SQL_LIST + """
                                                                    )
                """, subscriptionId);
        if (rows > 0) {
            log.warn("Subscription {} -> HALTED (7-day grace started)", subscriptionId);
            // Publish SubscriptionHaltedEvent so the admin gets an email +
            // in-app notification. Gated on rows>0 which means this call is
            // the one that actually transitioned the row — later reconciler
            // sweeps see status=HALTED and skip, so we don't spam.
            publishHalted(subscriptionId);
        }
        return rows > 0;
    }

    /** Read tenant/subdomain/grace_until for the halted row and fire the event. */
    private void publishHalted(String subscriptionId) {
        try {
            HaltedInfo info = jdbc.queryForObject("""
                    SELECT s.tenant_id, t.subdomain, s.grace_until
                      FROM platform.subscriptions s
                      JOIN platform.tenants t ON t.id = s.tenant_id
                     WHERE s.razorpay_subscription_id = ?
                     LIMIT 1
                    """, (rs, n) -> {
                Timestamp gu = rs.getTimestamp("grace_until");
                return new HaltedInfo(
                        UUID.fromString(rs.getString("tenant_id")),
                        rs.getString("subdomain"),
                        gu == null ? null : gu.toInstant());
            }, subscriptionId);
            if (info == null) return;
            events.publishEvent(new SubscriptionHaltedEvent(
                    info.tenantId, subscriptionId, info.subdomain, info.graceUntil));
        } catch (EmptyResultDataAccessException e) {
            log.warn("publishHalted({}) — row disappeared between UPDATE and SELECT; no event fired", subscriptionId);
        } catch (RuntimeException e) {
            // Swallow — a failed notification MUST NOT break the state
            // transition. The row is already HALTED; the customer's grace
            // window is running. Ops can grep the log if they miss an email.
            log.warn("publishHalted({}) failed: {}", subscriptionId, e.getMessage());
        }
    }

    private record HaltedInfo(UUID tenantId, String subdomain, Instant graceUntil) {}

    public void onCompleted(String subscriptionId) {
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status                = 'COMPLETED',
                    last_reconciled_at    = now(),
                    last_razorpay_status  = 'completed',
                    reconcile_error       = NULL,
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status NOT IN ('CANCELLED','EXPIRED')
                """, subscriptionId);
        if (rows > 0) log.info("Subscription {} -> COMPLETED (all charges done)", subscriptionId);
    }

    /**
     * Ask Razorpay for the trial-end + cycle-end so a cancel that arrives
     * BEFORE we ever stored a {@code current_period_end} / {@code trial_ends_at}
     * (webhook re-ordering, or the row was created before we started stamping
     * these columns 2026-08-10) still gets the correct grace_until.
     *
     * <p>Best-effort: any Razorpay error just returns null and the SQL below
     * falls back to a 3-day courtesy window. That way the reconciler never
     * blocks on Razorpay availability.
     */
    private java.sql.Timestamp resolveGraceFromRazorpay(String subscriptionId) {
        if (razorpay == null) return null;
        try {
            RazorpayClient.SubscriptionView v = razorpay.fetchSubscription(subscriptionId);
            if (v == null) return null;
            long now = System.currentTimeMillis() / 1000;
            // Trial-first, cycle-second — same precedence as the SQL COALESCE below.
            if (v.paidCount() != null && v.paidCount() == 0
                    && v.startAt() != null && v.startAt() > now) {
                return new java.sql.Timestamp(v.startAt() * 1000L);
            }
            if (v.currentEnd() != null && v.currentEnd() > now) {
                return new java.sql.Timestamp(v.currentEnd() * 1000L);
            }
        } catch (Exception e) {
            log.warn("onCancelled: could not fetch Razorpay sub {} for grace fallback: {}",
                    subscriptionId, e.getMessage());
        }
        return null;
    }

    public void onCancelled(String subscriptionId) {
        // Cancel != revoke-immediately. Netflix / Zoom / Razorpay-itself pattern:
        // if the customer paid for a period, they keep the product until that
        // period ends, then it goes dark. Anything else is theft of the days
        // they already paid for.
        //
        // Corrected 2026-08-10 after user feedback: the first cut of this method
        // revoked tenant_modules the instant CANCELLED landed, which would have
        // locked out a customer who cancelled ON day 20 of a monthly cycle they
        // paid for on day 1. Now:
        //
        //   1. Flip the row to CANCELLED and stamp grace_until = current_period_end.
        //      Absent a period end (mandate deleted before any charge, e.g. during
        //      trial), fall back to a short courtesy window so they can either
        //      re-authorise or export their data — 3 days is enough for a UPI
        //      re-setup and matches what Play/Apple give a cancelled sub.
        //   2. Do NOT touch tenant_modules here. RevokeExpiredCancelledJob (nightly)
        //      is the one place that flips modules to EXPIRED — it runs the
        //      "grace_until in the past" check against every CANCELLED row and
        //      revokes only those that have actually elapsed.
        //   3. SubscriptionAccessGuard also honours grace_until for CANCELLED
        //      subscriptions, so an in-flight request in the paid window is
        //      allowed even if the nightly sweep hasn't run yet.
        //
        // A tenant re-authorising during grace flips the sub back to ACTIVE via
        // subscription.activated, and grace_until is cleared by onActive.
        // grace_until logic (user request 2026-08-10):
        //   - Cancel DURING trial (trial_ends_at > now): keep access through the
        //     trial end but NO further — a customer who never paid should not
        //     get a paid period on top of their trial. Take LEAST(trial, cycle)
        //     as belt-and-braces in case current_period_end was set past trial.
        //   - Cancel after trial (or trial-less signup): honor the paid cycle;
        //     access until current_period_end.
        //   - Neither present (edge case: cancel before Razorpay set current_end):
        //     3-day courtesy so the admin can export data or re-subscribe.
        // For rows where our DB never learned trial_ends_at / current_period_end
        // (created before those columns landed, or webhook re-ordering), ask
        // Razorpay directly so a legitimate mid-trial cancel keeps access
        // through the day-7 mark instead of falling to the 3-day courtesy.
        // This is what the src/src123 backfill on 2026-08-10 had to do by
        // hand — the code now does it automatically for future cancels.
        java.sql.Timestamp fallbackGrace = jdbc.query(
                "SELECT trial_ends_at, current_period_end FROM platform.subscriptions " +
                "WHERE razorpay_subscription_id = ? LIMIT 1",
                rs -> {
                    if (!rs.next()) return null;
                    java.sql.Timestamp t = rs.getTimestamp("trial_ends_at");
                    java.sql.Timestamp c = rs.getTimestamp("current_period_end");
                    long now = System.currentTimeMillis();
                    boolean haveFuture = (t != null && t.getTime() > now)
                                       || (c != null && c.getTime() > now);
                    return haveFuture ? null : resolveGraceFromRazorpay(subscriptionId);
                }, subscriptionId);

        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status                = 'CANCELLED',
                    grace_until           = COALESCE(
                        CASE WHEN trial_ends_at IS NOT NULL AND trial_ends_at > now()
                             THEN LEAST(trial_ends_at,
                                        COALESCE(current_period_end, trial_ends_at))
                             ELSE current_period_end
                        END,
                        ?,                     -- Razorpay-derived fallback
                        now() + interval '3 days'),
                    last_reconciled_at    = now(),
                    last_razorpay_status  = 'cancelled',
                    reconcile_error       = NULL,
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status NOT IN ('COMPLETED','EXPIRED')
                """, fallbackGrace, subscriptionId);
        if (rows == 0) return;

        log.info("Subscription {} -> CANCELLED (access retained until grace_until, sweep will revoke)",
                subscriptionId);
    }

    /**
     * Nightly job entry point (called from PlanChangeSweepJob): revoke module
     * access for any CANCELLED/EXPIRED subscription whose grace period elapsed.
     * Kept idempotent — every run only flips the tenant_modules rows that are
     * still ACTIVE and whose *only* backing subscription has expired grace.
     *
     * @return the number of tenant_modules rows deactivated
     */
    public int revokeExpiredCancellations() {
        // B2/D6 FIX (2026-08-14) — SIBLING-IN-GRACE guard.
        //
        // Retired mandates from mandate-swap (UPI seat change) are written as
        // CANCELLED with grace_until = the REPLACEMENT's current_period_end
        // (see PlanChangeService.retireReplacedMandate). Until that
        // replacement fully activates and its own row starts carrying an
        // ACTIVE/TRIALING status, a naïve revoke sweep sees a CANCELLED row
        // whose grace has technically elapsed (or is NULL, because the
        // replacement's period end hadn't landed yet at retirement time) and
        // yanks tenant_modules on a paying customer. The extra NOT EXISTS
        // below refuses to revoke while ANY sibling row for the same tenant
        // is CANCELLED-but-still-in-grace — that sibling either is the
        // replacement's own paid grace, or is a co-mandate the customer paid
        // for. Either way the customer's access must not evaporate.
        int deactivated = jdbc.update("""
                UPDATE platform.tenant_modules tm SET
                    status      = 'EXPIRED',
                    expires_at  = now()
                  WHERE tm.status = 'ACTIVE'
                    AND EXISTS (
                        SELECT 1 FROM platform.subscriptions s
                         WHERE s.tenant_id = tm.tenant_id
                           AND s.status IN ('CANCELLED','EXPIRED','COMPLETED')
                           AND (s.grace_until IS NULL OR s.grace_until <= now())
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM platform.subscriptions s2
                         WHERE s2.tenant_id = tm.tenant_id
                           AND s2.status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','GRACE')
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM platform.subscriptions s3
                         WHERE s3.tenant_id = tm.tenant_id
                           AND s3.status = 'CANCELLED'
                           AND s3.grace_until IS NOT NULL
                           AND s3.grace_until > now()
                    )
                """);
        if (deactivated > 0) {
            log.info("revokeExpiredCancellations: deactivated {} tenant_modules row(s)", deactivated);
        }
        return deactivated;
    }

    public void onPaused(String subscriptionId) {
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status                = 'PAUSED',
                    last_reconciled_at    = now(),
                    last_razorpay_status  = 'paused',
                    reconcile_error       = NULL,
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status NOT IN (""" + TERMINAL_STATUSES_SQL_LIST + """
                                                                    )
                """, subscriptionId);
        if (rows > 0) log.info("Subscription {} -> PAUSED", subscriptionId);
    }

    /**
     * Handle subscription.updated — Razorpay-dashboard changes to quantity,
     * plan, or price. Refresh what we can from the payload without changing
     * status (the accompanying activated/charged event handles status).
     */
    public void onUpdated(String subscriptionId, JsonNode subNode) {
        Long currentEnd = optLong(subNode, "current_end");
        Long chargeAt   = optLong(subNode, "charge_at");
        Integer quantity = optInt(subNode, "quantity");
        String planId    = optText(subNode, "plan_id");
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    current_period_end    = COALESCE(to_timestamp(?), current_period_end),
                    next_charge_at        = COALESCE(to_timestamp(?), next_charge_at),
                    seats                 = COALESCE(?, seats),
                    razorpay_plan_id      = COALESCE(?, razorpay_plan_id),
                    last_reconciled_at    = now(),
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status NOT IN (""" + TERMINAL_STATUSES_SQL_LIST + """
                                                                    )
                """, currentEnd, chargeAt, quantity, planId, subscriptionId);
        if (rows > 0) log.info("Subscription {} updated (seats={}, plan={})", subscriptionId, quantity, planId);
    }

    // -- reconciliation entry point (called by cron + inline guard) ------------

    /**
     * Reconcile OUR ledger row against Razorpay's authoritative state. Called
     * by:
     *   1. {@code SubscriptionReconciliationJob} — hourly sweep of every
     *      ACTIVE / TRIALING / PAST_DUE / HALTED row (background safety net).
     *   2. {@code SubscriptionAccessGuard} — inline check just before returning
     *      402 on a HALTED-past-grace request (the "we shouldn't lock a
     *      customer whose payment actually went through" guarantee).
     *
     * <p>Idempotent — calling twice for the same subscription is fine.
     *
     * @return the razorpay status string reported by Razorpay ("active",
     *         "halted", ...) or {@code null} on Razorpay error (still
     *         stamps last_reconciled_at + reconcile_error so the queue
     *         advances instead of starving on a permanently-broken row).
     */
    public String reconcileFromRazorpay(String subscriptionId, RazorpayClient razorpay) {
        try {
            RazorpayClient.SubscriptionView v = razorpay.fetchSubscription(subscriptionId);
            applyRazorpayStatus(subscriptionId, v);
            return v.status();
        } catch (RuntimeException e) {
            // Even on failure, gate against terminal-status rows so a
            // transient Razorpay 5xx during a lookup for a CANCELLED
            // subscription doesn't bump updated_at / stamp reconcile_error
            // on a supposedly-frozen row (would misrepresent our audit
            // trail and contradict the class invariant).
            jdbc.update("""
                    UPDATE platform.subscriptions SET
                        last_reconciled_at = now(),
                        reconcile_error    = ?,
                        updated_at         = now()
                     WHERE razorpay_subscription_id = ?
                       AND status NOT IN (""" + TERMINAL_STATUSES_SQL_LIST + """
                                                                        )
                    """, e.getMessage(), subscriptionId);
            log.warn("reconcile({}) failed: {}", subscriptionId, e.getMessage());
            return null;
        }
    }

    /**
     * Map Razorpay's status string to the appropriate mutator. Matches the
     * webhook dispatch 1:1 (SubscriptionWebhookController.dispatch):
     *   active     → onActive (charged, subscription running)
     *   pending    → onPending (charge failed, Razorpay retrying)
     *   halted     → onHalted (all retries exhausted)
     *   completed  → onCompleted (all planned cycles done)
     *   cancelled  → onCancelled
     *   paused     → onPaused
     * <ul>
     *   <li><b>authenticated</b> is intentionally NOT mapped to onActive.
     *   Razorpay reports {@code authenticated} for a mandate that's been
     *   approved but has not yet been charged (TRIAL start_at futures,
     *   pre-first-charge PAID). Promoting that to ACTIVE would wrongly
     *   restore a legitimately-HALTED subscription just because the
     *   original mandate approval still shows up in the state machine.
     *   No-op is the correct behavior — the follow-up {@code subscription.charged}
     *   event (via webhook or a later reconciliation sweep) is what should
     *   promote to ACTIVE.</li>
     *   <li>Fake JsonNode uses {@code null} for missing scalar fields (not
     *   0L or ""), so {@code optLong} / {@code optText} return null and
     *   the COALESCE clauses in onActive/onPending preserve the existing
     *   column values. An empty payment_method would otherwise wipe the
     *   stored value because COALESCE treats "" as non-null.</li>
     * </ul>
     */
    private void applyRazorpayStatus(String subscriptionId, RazorpayClient.SubscriptionView v) {
        String status = v.status() == null ? "" : v.status().toLowerCase(java.util.Locale.ROOT);
        com.fasterxml.jackson.databind.node.ObjectNode fakeNode =
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        if (v.currentEnd()    != null) fakeNode.put("current_end",    v.currentEnd());
        if (v.chargeAt()      != null) fakeNode.put("charge_at",      v.chargeAt());
        if (v.paymentMethod() != null && !v.paymentMethod().isBlank())
            fakeNode.put("payment_method", v.paymentMethod());
        switch (status) {
            case "active"                  -> onActive(subscriptionId, fakeNode);
            case "authenticated"           -> log.debug(
                    "reconcile({}) upstream=authenticated — mandate approved, no charge yet; no state change",
                    subscriptionId);
            case "pending"                 -> onPending(subscriptionId, fakeNode);
            case "halted"                  -> onHalted(subscriptionId);
            case "completed"               -> onCompleted(subscriptionId);
            case "cancelled"               -> onCancelled(subscriptionId);
            case "paused"                  -> onPaused(subscriptionId);
            default -> log.debug("reconcile({}) upstream status={} — no mapping", subscriptionId, status);
        }
    }

    // -- payload accessors -----------------------------------------------------

    private static String optText(JsonNode n, String field) {
        if (n == null || n.isMissingNode()) return null;
        JsonNode f = n.get(field);
        if (f == null || f.isNull()) return null;
        String v = f.asText();
        // Normalise empty/blank to null so downstream COALESCE actually
        // preserves the existing column instead of overwriting with "".
        return (v == null || v.isBlank()) ? null : v;
    }

    private static Long optLong(JsonNode n, String field) {
        if (n == null || n.isMissingNode()) return null;
        JsonNode f = n.get(field);
        if (f == null || f.isNull() || !f.isNumber()) return null;
        long v = f.asLong();
        return v == 0 ? null : v;   // 0 → null so COALESCE keeps existing timestamp
    }

    private static Integer optInt(JsonNode n, String field) {
        if (n == null || n.isMissingNode()) return null;
        JsonNode f = n.get(field);
        if (f == null || f.isNull() || !f.isNumber()) return null;
        return f.asInt();
    }

    /** Helper for tests / manual triggers that need the current timestamp. */
    public Instant now() { return Instant.now(); }
}
