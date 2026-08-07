package com.unifiedtree.saas.payment.subscription;

import com.fasterxml.jackson.databind.JsonNode;
import com.unifiedtree.saas.payment.RazorpayClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;

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

    public SubscriptionStateReconciler(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
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
     */
    public void onHalted(String subscriptionId) {
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
                   AND status NOT IN (""" + TERMINAL_STATUSES_SQL_LIST + """
                                                                    )
                """, subscriptionId);
        if (rows > 0) log.warn("Subscription {} -> HALTED (7-day grace started)", subscriptionId);
    }

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

    public void onCancelled(String subscriptionId) {
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status                = 'CANCELLED',
                    last_reconciled_at    = now(),
                    last_razorpay_status  = 'cancelled',
                    reconcile_error       = NULL,
                    updated_at            = now()
                 WHERE razorpay_subscription_id = ?
                   AND status NOT IN ('COMPLETED','EXPIRED')
                """, subscriptionId);
        if (rows > 0) log.info("Subscription {} -> CANCELLED", subscriptionId);
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
