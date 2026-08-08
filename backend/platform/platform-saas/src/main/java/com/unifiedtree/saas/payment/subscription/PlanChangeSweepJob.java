package com.unifiedtree.saas.payment.subscription;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Every 10 minutes, heal in-workspace module purchases whose
 * {@code subscription.activated} webhook never reached us.
 *
 * <p>The interactive path ({@code GET /v1/workspace/plan/current}) already
 * recovers a stranded purchase the moment the admin re-opens {@code /plan}.
 * This job covers the admin who does NOT come back: pays, sees the spinner,
 * closes the laptop, and opens the workspace tomorrow expecting the module to
 * be there. Without it, their money is debited and the module stays locked
 * until someone files a support ticket — see {@link PlanChangeRecoveryService}
 * for why none of the other reconciliation paths catch this case.
 *
 * <p>Ten minutes is deliberate. Razorpay retries a failed webhook delivery for
 * up to 24 hours, so most gaps close on their own within minutes; this is the
 * net for the ones that don't. The query is indexed and returns zero rows in
 * the healthy case, so an idle sweep costs one cheap statement and no Razorpay
 * calls.
 *
 * <p>Offset to :05 past each ten-minute mark so it never lands on the same
 * second as {@code SubscriptionReconciliationJob} (:20 hourly) or
 * {@code PendingSignupSweepJob} (:00 hourly).
 */
@Component
public class PlanChangeSweepJob {

    private static final Logger log = LoggerFactory.getLogger(PlanChangeSweepJob.class);

    private static final int EXPIRY_BATCH_LIMIT = 500;

    private final PlanChangeRecoveryService recovery;

    public PlanChangeSweepJob(PlanChangeRecoveryService recovery) {
        this.recovery = recovery;
    }

    /** Every 10 minutes at :05 seconds past. */
    @Scheduled(cron = "5 */10 * * * *")
    public void sweep() {
        // Recover FIRST. Both passes verify against Razorpay before acting, so
        // ordering cannot cost anyone their money — but healing before expiring
        // keeps the common case out of the expiry path entirely and makes the
        // logs read in the order the events actually matter.
        try {
            int activated = recovery.sweepAll();
            if (activated > 0) {
                log.warn("plan-change sweep — RECOVERED {} stranded purchase(s) whose webhook was lost", activated);
            }
        } catch (RuntimeException e) {
            // A scheduled method that throws gets its next run cancelled in some
            // Spring configurations — never let one bad sweep kill the schedule.
            log.error("plan-change recovery sweep failed: {}", e.getMessage(), e);
        }

        // Then close out checkouts the customer never authorised — the most
        // common non-happy path (open the Razorpay tab, change your mind, close
        // it). Left open, these were quietly corrosive: the duplicate-purchase
        // guard read them as "a setup is in progress" and refused the
        // customer's next attempt to buy that module; the recovery queue
        // re-fetched the same dead subscriptions on every sweep and every
        // /plan load forever, eventually starving itself; and the customer's
        // UPI app kept advertising a pending UnifiedTree mandate.
        try {
            PlanChangeRecoveryService.ExpiryResult r = recovery.expireAbandoned(EXPIRY_BATCH_LIMIT);
            if (r.expired() > 0 || r.rescued() > 0) {
                log.info("plan-change expiry — closed {} abandoned checkout(s), rescued {} that were actually paid, skipped {}",
                        r.expired(), r.rescued(), r.skipped());
            }
        } catch (RuntimeException e) {
            log.error("plan-change expiry pass failed: {}", e.getMessage(), e);
        }
    }
}
