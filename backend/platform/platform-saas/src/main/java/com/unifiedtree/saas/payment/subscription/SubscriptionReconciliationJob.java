package com.unifiedtree.saas.payment.subscription;

import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Hourly safety-net that reconciles our {@code platform.subscriptions} rows
 * against Razorpay's authoritative state. Covers the "webhook was lost"
 * scenario — if Razorpay charged the customer but we never received the
 * {@code subscription.charged} event, this job detects the mismatch on the
 * next sweep and promotes our row to ACTIVE (clearing grace_until) so the
 * customer isn't wrongly locked out on day 8.
 *
 * <p>Complements the two other defenses:
 * <ol>
 *   <li>{@code SubscriptionWebhookController} — primary path (real-time).</li>
 *   <li>{@code SubscriptionAccessGuard} — inline check just before returning
 *       402, catches missed webhooks the instant the customer makes a
 *       request.</li>
 *   <li>This cron — belt-and-suspenders for the case where a customer
 *       makes ZERO requests during the last day of grace.</li>
 * </ol>
 *
 * <p>Design borrowed from {@code PendingSignupSweepJob}: bounded batch,
 * per-row try/catch, structured summary log line, idempotent underlying
 * calls (each mutator has WHERE-status guards).
 *
 * <p>Runs hourly at :20 to avoid colliding with PendingSignupSweepJob at :00.
 * Batch size 200 = 4800 rows/day, comfortably above realistic Indian-SMB
 * tenant volume for the next 6-12 months.
 */
@Component
public class SubscriptionReconciliationJob {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionReconciliationJob.class);
    private static final int BATCH_LIMIT = 200;
    private static final int RECONCILE_MIN_AGE_HOURS = 6;

    private final JdbcTemplate jdbc;
    private final RazorpayClient razorpay;
    private final SubscriptionStateReconciler reconciler;
    private final RazorpayProperties props;

    public SubscriptionReconciliationJob(JdbcTemplate jdbc,
                                         RazorpayClient razorpay,
                                         SubscriptionStateReconciler reconciler,
                                         RazorpayProperties props) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.reconciler = reconciler;
        this.props = props;
    }

    /** Cron: hourly at :20. Server-local time. Skipped if Razorpay isn't
     *  configured (local dev, CI). */
    @Scheduled(cron = "0 20 * * * *")
    public void sweep() {
        if (!props.isConfigured()) {
            log.debug("subscription-reconcile skipped — Razorpay not configured");
            return;
        }
        runOnce();
    }

    /** Same body as the scheduled sweep but invocable manually — handy for
     *  ops tickets ("please reconcile this tenant right now"). */
    public SweepResult runOnce() {
        Instant startedAt = Instant.now();
        List<Row> batch = fetchBatch();
        if (batch.isEmpty()) {
            log.debug("subscription-reconcile — nothing to do");
            return new SweepResult(0, 0, 0, 0);
        }

        int checked = 0, mismatches = 0, razorpayErrors = 0, restored = 0;
        for (Row r : batch) {
            checked++;
            try {
                String before = r.status();
                String upstream = reconciler.reconcileFromRazorpay(r.razorpaySubscriptionId(), razorpay);
                if (upstream == null) {
                    razorpayErrors++;
                    continue;
                }
                if (!upstreamMatches(before, upstream)) {
                    mismatches++;
                    if (before.equals("HALTED") && upstream.equalsIgnoreCase("active")) {
                        restored++;
                    }
                    log.info("subscription-reconcile MISMATCH  sub={} ours={} razorpay={}",
                            r.razorpaySubscriptionId(), before, upstream);
                }
            } catch (RuntimeException e) {
                // Per-row failure never halts the batch.
                razorpayErrors++;
                log.warn("subscription-reconcile row failed  sub={} err={}",
                        r.razorpaySubscriptionId(), e.getMessage());
            }
        }
        long elapsedMs = java.time.Duration.between(startedAt, Instant.now()).toMillis();
        log.info("subscription-reconcile — checked {} mismatches {} restored {} razorpay_errors {} in {} ms",
                checked, mismatches, restored, razorpayErrors, elapsedMs);
        return new SweepResult(checked, mismatches, restored, razorpayErrors);
    }

    private List<Row> fetchBatch() {
        List<Row> out = new ArrayList<>();
        jdbc.query("""
                SELECT id, razorpay_subscription_id, status, halted_at
                  FROM platform.subscriptions
                 WHERE razorpay_subscription_id IS NOT NULL
                   AND status IN ('ACTIVE','TRIALING','PAST_DUE','HALTED')
                   AND (last_reconciled_at IS NULL
                        OR last_reconciled_at < now() - interval '""" + RECONCILE_MIN_AGE_HOURS + """
                                                                                          hours')
                 ORDER BY
                     -- HALTED rows near grace expiry first — that's where a
                     -- missed webhook has the highest customer impact.
                     (CASE WHEN status = 'HALTED' THEN 0 ELSE 1 END),
                     last_reconciled_at NULLS FIRST
                 LIMIT ?
                """, rs -> {
            Timestamp t = rs.getTimestamp("halted_at");
            out.add(new Row(
                    rs.getString("id"),
                    rs.getString("razorpay_subscription_id"),
                    rs.getString("status"),
                    t == null ? null : t.toInstant()));
        }, BATCH_LIMIT);
        return out;
    }

    private static boolean upstreamMatches(String ourStatus, String razorpayStatus) {
        String r = razorpayStatus == null ? "" : razorpayStatus.toLowerCase();
        return switch (ourStatus) {
            case "ACTIVE"     -> r.equals("active") || r.equals("authenticated");
            case "TRIALING"   -> r.equals("active") || r.equals("authenticated");
            case "PAST_DUE"   -> r.equals("pending");
            case "HALTED"     -> r.equals("halted");
            case "PAUSED"     -> r.equals("paused");
            case "COMPLETED"  -> r.equals("completed");
            case "CANCELLED"  -> r.equals("cancelled");
            default -> false;
        };
    }

    /** Sweep summary — exposed via runOnce() so ops endpoints can echo it. */
    public record SweepResult(int checked, int mismatches, int restored, int razorpayErrors) {}

    private record Row(String id, String razorpaySubscriptionId, String status, Instant haltedAt) {}
}
