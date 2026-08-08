package com.unifiedtree.saas.payment.subscription;

import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Self-heal for the "customer paid but the webhook never arrived" hole on a
 * FIRST module purchase.
 *
 * <p><b>The hole this closes.</b> Our three existing safety nets — the
 * request-time {@code SubscriptionAccessGuard}, the hourly
 * {@code SubscriptionReconciliationJob}, and webhook re-delivery — all read
 * from {@code platform.subscriptions}. On a first purchase that row does not
 * exist yet: it is written by {@link PlanChangeService#activate}, which only
 * runs when {@code subscription.activated} lands. Lose that single webhook and
 * the customer's money is debited, {@code plan_change_requests} sits at
 * AWAITING_MANDATE forever, {@code tenant_modules} is never written, the module
 * stays locked — and every net sweeps past because their queries return zero
 * rows. The frontend polls for 30 minutes then tells the admin to "refresh the
 * page", which did nothing. Support ticket was the only exit.
 *
 * <p><b>How it heals.</b> We ask Razorpay — the authority on whether money
 * actually moved — about every stranded request, and activate the ones it
 * confirms. Two triggers:
 * <ol>
 *   <li>{@link #recoverForTenant} runs when the admin loads {@code /plan}
 *       (wired into {@code GET /v1/workspace/plan/current}) and behind an
 *       explicit "I paid but it's still locked" button. This is what finally
 *       makes "refresh the page" true.</li>
 *   <li>{@link #sweepAll} runs on a cron for the admin who closes the laptop
 *       and comes back tomorrow.</li>
 * </ol>
 *
 * <p><b>Which Razorpay statuses count as paid.</b> Mirrors the webhook's own
 * dispatch exactly ({@code SubscriptionWebhookController.dispatch}) so the two
 * paths can never disagree about what "activated" means:
 * <ul>
 *   <li>{@code active} — charged and running.</li>
 *   <li>{@code authenticated} — mandate approved, first charge still pending
 *       (this is the normal state for our 7-day-trial subscriptions, whose
 *       {@code start_at} is a week out). The webhook activates modules on
 *       {@code subscription.authenticated} too: the trial has begun and the
 *       customer is entitled to access.</li>
 * </ul>
 * Everything else is left alone. {@code created} means the customer never
 * finished authorising, so there is nothing to recover; {@code halted} /
 * {@code pending} are charge failures the normal ledger path handles; and
 * terminal states get their row closed out so it stops being re-checked and
 * stops blocking the duplicate-purchase guard.
 *
 * <p><b>Cost control.</b> {@code findStranded} is an indexed lookup that
 * returns zero rows for the overwhelmingly common healthy case, so the
 * page-load path costs one cheap query and zero Razorpay calls. We only reach
 * Razorpay when a genuinely stuck row exists. Rows younger than
 * {@link #MIN_AGE_SECONDS_INTERACTIVE} are skipped so we never race a webhook
 * that is already in flight.
 */
@Service
public class PlanChangeRecoveryService {

    private static final Logger log = LoggerFactory.getLogger(PlanChangeRecoveryService.class);

    /** Give the webhook a head start before we start second-guessing it. */
    private static final int MIN_AGE_SECONDS_INTERACTIVE = 45;
    /** The cron is not racing a user, so it can be more patient. */
    private static final int MIN_AGE_SECONDS_SWEEP = 300;

    /**
     * How many stranded rows the page-load path will check. Each check is a
     * SEQUENTIAL Razorpay call that can burn the client's full 20s read
     * timeout, and the browser aborts the whole request at 60s — so a high
     * limit turns a slow-Razorpay window into a failed {@code /plan} load,
     * which now surfaces as the red "purchasing is paused" banner on a
     * perfectly healthy workspace. Two keeps the worst case (~40s) inside the
     * client budget; the 10-minute sweep picks up any remainder, and the
     * common case is a single row anyway.
     */
    private static final int LIMIT_INTERACTIVE = 2;
    /** Wall-clock ceiling for the interactive path, independent of row count. */
    private static final long INTERACTIVE_BUDGET_MS = 25_000L;
    private static final int LIMIT_SWEEP = 200;

    private final PlanChangeService planChanges;
    private final SubscriptionService subscriptions;
    private final RazorpayClient razorpay;
    private final RazorpayProperties props;

    public PlanChangeRecoveryService(PlanChangeService planChanges,
                                     SubscriptionService subscriptions,
                                     RazorpayClient razorpay,
                                     RazorpayProperties props) {
        this.planChanges = planChanges;
        this.subscriptions = subscriptions;
        this.razorpay = razorpay;
        this.props = props;
    }

    /**
     * Heal one workspace. Safe and cheap to call on every {@code /plan} load —
     * returns immediately without touching Razorpay when nothing is stranded.
     *
     * @return how many requests were activated
     */
    public int recoverForTenant(UUID tenantId) {
        if (tenantId == null || !props.isConfigured()) return 0;
        return recover(planChanges.findStranded(tenantId, MIN_AGE_SECONDS_INTERACTIVE, LIMIT_INTERACTIVE),
                       INTERACTIVE_BUDGET_MS);
    }

    /** Heal every workspace — the cron entry point. No deadline: nobody waits. */
    public int sweepAll() {
        if (!props.isConfigured()) return 0;
        return recover(planChanges.findStranded(null, MIN_AGE_SECONDS_SWEEP, LIMIT_SWEEP), 0L);
    }

    /**
     * Close out checkouts past their 24-hour expiry — but ONLY after Razorpay
     * confirms the customer never actually authorised the mandate.
     *
     * <p><b>Why the Razorpay check is mandatory here.</b> Expiry cancels the
     * upstream subscription. If we expired on the timestamp alone, this
     * sequence would destroy a real customer's paid mandate: customer pays,
     * the {@code subscription.activated} webhook is lost, and recovery then
     * fails to run for 24 hours — a long Razorpay outage, or our own service
     * being down over a weekend. The row crosses {@code expires_at}, the
     * sweep cancels a subscription the customer has already been charged for,
     * and the module they paid for can never activate. Asking Razorpay first
     * makes that unreachable: a paid mandate reports {@code active} or
     * {@code authenticated} and gets ACTIVATED instead of expired. Only a
     * genuinely never-authorised {@code created} subscription is cancelled.
     *
     * <p>Statuses that mean "charge trouble" ({@code pending}, {@code halted})
     * are left alone entirely — those belong to the ledger/grace path, and
     * cancelling the mandate underneath them would remove the customer's
     * ability to recover by fixing their payment method.
     *
     * @return counts of what happened, for the sweep's summary log
     */
    public ExpiryResult expireAbandoned(int limit) {
        if (!props.isConfigured()) return new ExpiryResult(0, 0, 0);
        List<PlanChangeService.Stranded> due = planChanges.findExpiredAwaiting(limit);
        if (due.isEmpty()) return new ExpiryResult(0, 0, 0);

        int expired = 0, rescued = 0, skipped = 0;
        for (PlanChangeService.Stranded s : due) {
            try {
                String status = upstreamStatus(s);
                switch (status) {
                    case "active", "authenticated" -> {
                        // Paid after all — the expiry timer nearly cost this
                        // customer their money. Recover instead.
                        if (planChanges.activate(s.id())) {
                            rescued++;
                            log.warn("plan-change RESCUED-AT-EXPIRY request={} tenant={} sub={} razorpay={} "
                                     + "— row was past expiry but the mandate IS authorised; activated instead of cancelled",
                                    s.id(), s.tenantId(), s.razorpaySubscriptionId(), status);
                        }
                    }
                    case "pending" -> {
                        // A charge is still being retried upstream. Cancelling
                        // now would destroy a mandate that may yet succeed, so
                        // leave it — it will resolve to active or halted and be
                        // handled on a later sweep.
                        skipped++;
                        log.info("plan-change request={} past expiry but upstream=pending "
                                 + "(charge still being retried) — leaving untouched", s.id());
                    }
                    case "halted" -> {
                        // Razorpay exhausted its retries: this mandate is dead
                        // and will never charge. It must be closed out, not
                        // skipped. Because activate() never ran there is no
                        // platform.subscriptions row, so the grace/ledger path
                        // that normally owns HALTED cannot see this at all —
                        // skipping it would leave the row blocking the
                        // duplicate guard forever, permanently barring the
                        // customer from buying the module they failed to pay
                        // for. Cancel upstream and free them to start fresh.
                        cancelUpstreamQuietly(s);
                        if (planChanges.markExpired(s.id())) {
                            expired++;
                            log.warn("plan-change request={} tenant={} closed out — mandate HALTED before "
                                     + "first charge; customer can now retry the purchase",
                                    s.id(), s.tenantId());
                        }
                    }
                    default -> {
                        // "created" (never authorised), or already
                        // cancelled/expired/completed upstream.
                        cancelUpstreamQuietly(s);
                        if (planChanges.markExpired(s.id())) expired++;
                    }
                }
            } catch (RuntimeException e) {
                // Never expire a row we could not verify — if Razorpay is
                // unreachable we simply try again on the next sweep. Silence
                // here is safer than cancelling a possibly-paid mandate.
                skipped++;
                log.warn("plan-change expiry check failed for request={} sub={} — leaving untouched: {}",
                        s.id(), s.razorpaySubscriptionId(), e.getMessage());
            }
        }
        return new ExpiryResult(expired, rescued, skipped);
    }

    private String upstreamStatus(PlanChangeService.Stranded s) {
        if (s.razorpaySubscriptionId() == null || s.razorpaySubscriptionId().isBlank()) {
            // Never reached Razorpay at all (create() failed between the row
            // insert and the API call). Nothing upstream to protect.
            return "created";
        }
        RazorpayClient.SubscriptionView v = razorpay.fetchSubscription(s.razorpaySubscriptionId());
        return v.status() == null ? "" : v.status().toLowerCase(Locale.ROOT);
    }

    private void cancelUpstreamQuietly(PlanChangeService.Stranded s) {
        if (s.razorpaySubscriptionId() == null || s.razorpaySubscriptionId().isBlank()) return;
        try {
            subscriptions.cancelPreAuth(s.razorpaySubscriptionId());
        } catch (Exception e) {
            // Our row is the source of truth for whether the customer may
            // retry; a stale Razorpay subscription is tolerable (and they
            // expire it themselves eventually).
            log.warn("expiry: cancelPreAuth failed for request={} sub={} — expiring locally anyway: {}",
                    s.id(), s.razorpaySubscriptionId(), e.getMessage());
        }
    }

    /** @param expired closed out  @param rescued found paid and activated  @param skipped left for later */
    public record ExpiryResult(int expired, int rescued, int skipped) {}

    // -------------------------------------------------------------------------

    /**
     * @param budgetMs stop starting new Razorpay calls once this much wall
     *                 clock has elapsed; 0 means no deadline. Guards the
     *                 page-load path against a slow (rather than failing)
     *                 Razorpay: the controller's try/catch can swallow an
     *                 exception but not latency, and an over-long /current
     *                 is aborted by the browser at 60s, which the frontend
     *                 correctly reads as "couldn't load the plan" and turns
     *                 into a purchase-blocking banner.
     */
    private int recover(List<PlanChangeService.Stranded> stranded, long budgetMs) {
        if (stranded.isEmpty()) return 0;
        long deadline = budgetMs > 0 ? System.currentTimeMillis() + budgetMs : Long.MAX_VALUE;
        int activated = 0, deferred = 0;
        for (PlanChangeService.Stranded s : stranded) {
            if (System.currentTimeMillis() >= deadline) {
                deferred++;
                continue;   // the 10-minute sweep has no deadline; let it finish the job
            }
            try {
                if (recoverOne(s)) activated++;
            } catch (RuntimeException e) {
                // One bad row (Razorpay 5xx, malformed plan_items, a race with
                // the real webhook) must never stop us healing the others.
                log.warn("plan-change recovery failed for request={} sub={}: {}",
                        s.id(), s.razorpaySubscriptionId(), e.getMessage());
            }
        }
        if (deferred > 0) {
            log.info("plan-change recovery hit its {}ms interactive budget — deferred {} row(s) to the sweep",
                    budgetMs, deferred);
        }
        return activated;
    }

    private boolean recoverOne(PlanChangeService.Stranded s) {
        RazorpayClient.SubscriptionView view = razorpay.fetchSubscription(s.razorpaySubscriptionId());
        String status = view.status() == null ? "" : view.status().toLowerCase(Locale.ROOT);

        switch (status) {
            case "active", "authenticated" -> {
                // Razorpay says the mandate is good and (for "active") money has
                // moved. The webhook that should have told us was lost. Activate
                // now. activate() is idempotent and re-checks AWAITING_MANDATE
                // under its own transaction, so if the real webhook lands at the
                // same moment exactly one of us wins and the other no-ops —
                // returning false, which must NOT be counted as a recovery.
                // Counting no-ops would inflate the sweep's "webhook was lost"
                // warning (a signal that exists precisely to detect real webhook
                // loss) and would tell an admin "your module is now unlocked"
                // when this call did nothing.
                boolean didActivate = planChanges.activate(s.id());
                if (didActivate) {
                    log.warn("plan-change RECOVERED request={} tenant={} sub={} razorpay={} "
                             + "— webhook was lost, modules activated by self-heal",
                            s.id(), s.tenantId(), s.razorpaySubscriptionId(), status);
                } else {
                    log.info("plan-change request={} already resolved by the webhook; recovery no-op", s.id());
                }
                return didActivate;
            }
            case "cancelled", "expired", "completed" -> {
                // Nothing to recover, and leaving the row AWAITING_MANDATE would
                // both re-check it forever and keep the duplicate-purchase guard
                // tripping, blocking a legitimate retry.
                planChanges.markCancelled(s.id());
                log.info("plan-change request={} closed out — Razorpay reports {}", s.id(), status);
                return false;
            }
            default -> {
                // "created"  → customer never finished authorising the mandate.
                // "pending" / "halted" → charge trouble; the ledger path owns it.
                log.debug("plan-change request={} still {} upstream — leaving as-is", s.id(), status);
                return false;
            }
        }
    }
}
