package com.unifiedtree.saas.signup;

import com.unifiedtree.saas.payment.subscription.SubscriptionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * Hourly sweep over {@code platform.pending_signups} that expires abandoned
 * autopay signups. A row is "abandoned" when it has been sitting in
 * {@code AWAITING_MANDATE} past its 24-hour {@code expires_at} — the user
 * clicked "Pay" on our form, was redirected to Razorpay's checkout, and
 * never came back (closed the tab, UPI app crashed, etc.).
 *
 * <p>Two things happen per abandoned row:
 * <ol>
 *   <li>Cancel the Razorpay subscription — otherwise the customer's UPI
 *       app keeps showing "You have a pending mandate from UnifiedTree"
 *       for weeks and refuses to register a fresh one when they retry.</li>
 *   <li>Flip status to {@code CANCELLED}, which releases the partial
 *       unique index on {@code lower(subdomain) WHERE status='AWAITING_MANDATE'}
 *       so the subdomain becomes registrable again.</li>
 * </ol>
 *
 * <p>Ordering matters: we call Razorpay first. If Razorpay fails
 * (network hiccup, subscription already cancelled server-side), we still
 * mark our row CANCELLED — the DB row is our source of truth for
 * subdomain reservations, and we can afford a stale Razorpay subscription
 * (they auto-expire on their side too).
 *
 * <p>Cadence: every hour on the hour. Not more aggressive — a user who
 * abandons at 23:59 gets nearly 25 hours of leeway before we cancel;
 * anyone genuinely returning inside 24h is unaffected. Not less
 * aggressive — leaving abandoned rows around for a full day past
 * expiry burns the subdomain reservation for that long.
 *
 * <p>Bounded batch (500 rows/sweep) so a large backlog cannot make one
 * sweep run for hours. If more than 500 rows are due, the next hourly
 * sweep picks up the rest.
 *
 * <p>Idempotent: {@link PendingSignupService#markCancelled} only touches
 * rows still in {@code AWAITING_MANDATE}, and {@link SubscriptionService#cancelPreAuth}
 * swallows Razorpay's "already cancelled" errors — a re-run of the sweep
 * is a no-op.
 */
@Component
public class PendingSignupSweepJob {

    private static final Logger log = LoggerFactory.getLogger(PendingSignupSweepJob.class);
    private static final int BATCH_LIMIT = 500;

    private final PendingSignupService pending;
    private final SubscriptionService subscriptions;

    public PendingSignupSweepJob(PendingSignupService pending,
                                 SubscriptionService subscriptions) {
        this.pending = pending;
        this.subscriptions = subscriptions;
    }

    /** {@code cron = "0 0 * * * *"} — every hour on the hour, server-local time. */
    @Scheduled(cron = "0 0 * * * *")
    public void sweep() {
        Instant now = Instant.now();
        List<PendingSignupService.PendingSignup> expired = pending.findExpiredAwaiting(now, BATCH_LIMIT);
        if (expired.isEmpty()) return;

        int ok = 0;
        int razorpayErrors = 0;
        for (PendingSignupService.PendingSignup p : expired) {
            try {
                if (p.razorpaySubscriptionId() != null && !p.razorpaySubscriptionId().isBlank()) {
                    try {
                        subscriptions.cancelPreAuth(p.razorpaySubscriptionId());
                    } catch (Exception rzpErr) {
                        // cancelPreAuth already swallows Razorpay errors, so this
                        // catch is defensive — if it ever escapes we still want
                        // to mark our row CANCELLED so the subdomain frees up.
                        razorpayErrors++;
                        log.warn("sweep: cancelPreAuth threw for pending={} razorpay_sub={} — marking CANCELLED anyway: {}",
                                p.id(), p.razorpaySubscriptionId(), rzpErr.getMessage());
                    }
                }
                pending.markCancelled(p.id());
                ok++;
            } catch (Exception e) {
                // Single-row failure never blocks the sweep; next run tries again.
                log.error("sweep: failed to expire pending={} subdomain={}: {}",
                        p.id(), p.subdomain(), e.getMessage(), e);
            }
        }
        log.info("pending_signups sweep — expired {} (razorpay errors: {}, backlog remaining: {})",
                ok, razorpayErrors, Math.max(0, expired.size() - ok));
    }
}
