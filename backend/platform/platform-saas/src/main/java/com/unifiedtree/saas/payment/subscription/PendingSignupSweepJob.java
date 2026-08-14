package com.unifiedtree.saas.payment.subscription;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.signup.MandateProvisioningService;
import com.unifiedtree.saas.signup.PendingSignupService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Every 5 minutes, self-heal the "customer paid but the webhook never
 * arrived" hole on a fresh-workspace signup.
 *
 * <p><b>Why this exists.</b> This is the companion to the B2 webhook fix
 * (dispatch-before-insert-on-success). B2 stops FUTURE deliveries from being
 * permanently swallowed on a dispatch failure, but any event that was silently
 * dropped BEFORE B2 landed left a {@code platform.pending_signups} row wedged
 * at {@code AWAITING_MANDATE} with the customer's Razorpay mandate already
 * authorised. The signup poll times out at ~30 minutes, the browser tells the
 * admin to "refresh the page", refresh does nothing, and the money is debited
 * against a workspace that never gets created.
 *
 * <p><b>How it heals.</b> We ask Razorpay — the authority on whether money
 * moved — about every pending row older than an hour, and provision the ones
 * it confirms. {@link MandateProvisioningService#provisionFromPending} is
 * idempotent (keyed by pending_signups.id), so on the rare race where the
 * real webhook lands the same minute we finish, the second call is a no-op.
 *
 * <p><b>Not to be confused with</b> the sibling
 * {@link com.unifiedtree.saas.signup.PendingSignupSweepJob} which lives in
 * the signup/ package. That job is the 24-hour ABANDONMENT sweep — it
 * cancels a truly-abandoned checkout so the subdomain reservation frees.
 * This job is the SHORT-INTERVAL RECOVERY sweep — it provisions the ones
 * the customer DID pay for. Two different modes of failure, two different
 * cadences, distinct bean names so Spring can wire both.
 *
 * <p><b>Cadence.</b> {@code fixedDelayString = "PT5M"} — a 5-minute delay
 * between runs (measured from the previous completion, not the previous
 * start, so a slow Razorpay cycle can't stack). Bounded batch of 200 rows
 * per sweep so a large backlog cannot make one sweep run for an hour and
 * hold the workflow open past its budget. If more than 200 rows are due,
 * the next run picks up the rest.
 *
 * <p><b>Transaction discipline.</b> Each row is processed inside its OWN
 * {@code REQUIRES_NEW} transaction. Two reasons:
 * <ol>
 *   <li>{@code MandateProvisioningService.provisionFromPending} eventually
 *       delegates to {@code SaasWriter.signup}, which is RLS-sensitive and
 *       relies on {@code SET LOCAL app.tenant_id} being scoped to a live
 *       transaction. See {@code MEMORY.md :: rls-after-commit-trap} — a
 *       {@code SET LOCAL} outside a live tx silently returns zero rows on
 *       every RLS table.</li>
 *   <li>Row isolation. A single bad row (Postgres blip, Razorpay 5xx) must
 *       never poison the outer transaction and abort the sweep. Each row
 *       commits or rolls back independently.</li>
 * </ol>
 * We use {@link TransactionTemplate} rather than an {@code @Transactional}
 * method because self-invocation of an annotated method bypasses the Spring
 * proxy — the annotation would be silently inert.
 */
@Component("pendingSignupMandateSweepJob")
public class PendingSignupSweepJob {

    private static final Logger log = LoggerFactory.getLogger(PendingSignupSweepJob.class);

    /** Give the webhook a head start before we start second-guessing it. */
    private static final int MIN_AGE_INTERVAL = 60;   // minutes; matches the SQL below
    private static final int BATCH_LIMIT = 200;

    private final JdbcTemplate jdbc;
    private final PendingSignupService pending;
    private final MandateProvisioningService provisioning;
    private final RazorpayClient razorpay;
    private final RazorpayProperties props;
    private final TransactionTemplate txTemplate;
    private final Metrics metrics;

    public PendingSignupSweepJob(JdbcTemplate jdbc,
                                 PendingSignupService pending,
                                 MandateProvisioningService provisioning,
                                 RazorpayClient razorpay,
                                 RazorpayProperties props,
                                 PlatformTransactionManager txManager,
                                 @Autowired(required = false) Metrics metrics) {
        this.jdbc = jdbc;
        this.pending = pending;
        this.provisioning = provisioning;
        this.razorpay = razorpay;
        this.props = props;
        this.txTemplate = new TransactionTemplate(txManager);
        this.txTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.metrics = metrics == null ? Metrics.noop() : metrics;
    }

    /**
     * Runs 5 minutes after the previous completion. {@code fixedDelayString}
     * takes an ISO-8601 duration so ops can tune it via
     * {@code -Dunifiedtree.sweep.pending-recovery=PT10M} without a rebuild.
     */
    @Scheduled(fixedDelayString = "${unifiedtree.sweep.pending-recovery:PT5M}")
    public void sweep() {
        if (!props.isConfigured()) return;   // no Razorpay credentials, nothing to check

        List<UUID> due = jdbc.queryForList(
                "SELECT id FROM platform.pending_signups " +
                " WHERE status = 'AWAITING_MANDATE' " +
                "   AND created_at < now() - interval '1 hour' " +
                " ORDER BY created_at ASC LIMIT ?",
                UUID.class, BATCH_LIMIT);
        if (due.isEmpty()) return;

        int recovered = 0, skipped = 0, failed = 0;
        for (UUID id : due) {
            try {
                Outcome o = txTemplate.execute(status -> processOne(id));
                switch (o) {
                    case RECOVERED -> {
                        recovered++;
                        metrics.sweptRecovered();
                    }
                    case SKIPPED -> {
                        skipped++;
                        metrics.sweptSkipped();
                    }
                    case NOT_YET -> {
                        skipped++;
                        metrics.sweptNotYet();
                    }
                }
            } catch (RuntimeException e) {
                failed++;
                metrics.sweptFailed();
                // Single-row failure must NEVER stop the sweep — the next run
                // tries again. Log with enough context that ops can trace it
                // back to a specific pending_signup.
                log.error("pending-signup recovery sweep: row={} failed: {}", id, e.getMessage(), e);
            }
        }
        if (recovered > 0 || failed > 0) {
            log.warn("pending-signup recovery sweep — considered {}, RECOVERED {}, skipped {}, failed {}",
                    due.size(), recovered, skipped, failed);
        } else {
            log.debug("pending-signup recovery sweep — considered {}, all still awaiting mandate", due.size());
        }
    }

    /**
     * Called inside a REQUIRES_NEW transaction (see class javadoc). Returns
     * an {@link Outcome} instead of throwing so the caller can bucket results
     * for the summary log; RuntimeException still bubbles for genuine
     * plumbing failures (DB down, unexpected NPE).
     */
    private Outcome processOne(UUID pendingId) {
        Optional<PendingSignupService.PendingSignup> maybe = pending.findById(pendingId);
        if (maybe.isEmpty()) return Outcome.SKIPPED;    // already deleted / never existed
        PendingSignupService.PendingSignup p = maybe.get();

        // Re-check status inside the tx — a webhook that landed between our
        // SELECT and this point may have already provisioned this row.
        if (!"AWAITING_MANDATE".equals(p.status())) return Outcome.SKIPPED;

        String subId = p.razorpaySubscriptionId();
        if (subId == null || subId.isBlank()) return Outcome.SKIPPED;

        RazorpayClient.SubscriptionView view;
        try {
            view = razorpay.fetchSubscription(subId);
        } catch (RuntimeException rzp) {
            // Razorpay unreachable / row missing upstream — leave for the next
            // sweep rather than making a decision on stale data. cancelPreAuth
            // is NOT called here; that's the 24-hour abandonment sweep's job.
            log.info("pending-signup recovery: sub={} not readable this cycle, deferring: {}",
                    subId, rzp.getMessage());
            return Outcome.NOT_YET;
        }
        String status = view.status() == null ? "" : view.status().toLowerCase(Locale.ROOT);
        if (!("authenticated".equals(status) || "active".equals(status))) {
            // "created" → customer never finished; "cancelled"/"expired"/"completed"
            // → nothing to recover; "halted"/"pending" → charge trouble, not our
            // problem. Only paid mandates are eligible for the "provision the
            // workspace" side of the recovery.
            log.debug("pending-signup recovery: sub={} upstream={} — not eligible for provisioning",
                    subId, status);
            return Outcome.SKIPPED;
        }

        // Build a minimal subscription entity JsonNode so provisionFromPending
        // can seed current_period_end / next_charge_at / payment_method on the
        // platform.subscriptions row without a second Razorpay round-trip.
        ObjectNode entity = JsonNodeFactory.instance.objectNode();
        entity.put("id", view.id());
        if (view.currentEnd() != null) entity.put("current_end", view.currentEnd());
        if (view.chargeAt() != null)   entity.put("charge_at",   view.chargeAt());
        if (view.paymentMethod() != null) entity.put("payment_method", view.paymentMethod());

        UUID tenantId = provisioning.provisionFromPending(p.id(), entity, "sweep:pending-recovery");
        if (tenantId != null) {
            log.warn("pending-signup RECOVERED id={} sub={} upstream={} tenant={} " +
                     "— webhook was lost, workspace provisioned by self-heal",
                    p.id(), subId, status, tenantId);
            return Outcome.RECOVERED;
        }
        // provisionFromPending returned null — the row moved to FAILED (which
        // it logs itself) or was raced to PROVISIONED by another caller.
        return Outcome.SKIPPED;
    }

    private enum Outcome { RECOVERED, SKIPPED, NOT_YET }

    // --------------------------------------------------------------------
    //  Metrics — decoupled from the sweep so a test can inject a fake and
    //  the compile still succeeds when micrometer is absent (though we
    //  declare it as an optional pom dep, we tolerate its absence at
    //  runtime by injecting the no-op).
    // --------------------------------------------------------------------

    /**
     * Sweep-specific counters. Concrete implementation lives in
     * {@link WebhookMetrics} which also owns the webhook counters; this
     * component-typed alias keeps the constructor signature narrow.
     */
    public interface Metrics {
        void sweptRecovered();
        void sweptSkipped();
        void sweptNotYet();
        void sweptFailed();

        static Metrics noop() {
            return new Metrics() {
                @Override public void sweptRecovered() { }
                @Override public void sweptSkipped()   { }
                @Override public void sweptNotYet()    { }
                @Override public void sweptFailed()    { }
            };
        }
    }
}
