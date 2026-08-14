package com.unifiedtree.saas.payment.subscription;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * Micrometer counters for the Razorpay webhook receiver and the
 * pending-signup recovery sweep (bundle B11 — 2026-08-14).
 *
 * <p>Exposed metrics:
 * <ul>
 *   <li>{@code razorpay_webhook_total{event, outcome}} — every webhook that
 *       reaches the receiver. {@code outcome ∈ {ok, duplicate, dispatch_error,
 *       missing_event, missing_body}}.</li>
 *   <li>{@code razorpay_webhook_signature_failed_total} — HMAC verification
 *       rejected the request (attack, misconfiguration, or wrong secret
 *       rotated in a stale environment).</li>
 *   <li>{@code razorpay_webhook_dispatch_error_total} — dispatch(...) threw;
 *       Razorpay is being asked to retry.</li>
 *   <li>{@code pending_signup_swept_total{outcome}} — the recovery sweep's
 *       per-row outcome. {@code outcome ∈ {recovered, skipped, not_yet,
 *       failed}}.</li>
 * </ul>
 *
 * <p>Wired into hrms-app's Prometheus endpoint via
 * {@code application-canonical-prod.yml}. See the "TODO(audit B11): open VPC
 * firewall on management port" comment there — the endpoint stays private
 * until we've placed it behind the VPC firewall so per-endpoint latency and
 * internal topology can't be scraped anonymously.
 *
 * <p><b>MeterRegistry is optional at runtime.</b> The pom declares
 * {@code micrometer-core} as {@code <optional>true</optional>} — it is on
 * the classpath at compile time from platform-saas and at runtime because
 * hrms-app pulls the prometheus registry transitively. If for any reason
 * (dev harness without actuator, a stripped-down slice test) no MeterRegistry
 * bean is present, {@link ObjectProvider#getIfAvailable} returns null and
 * every increment becomes a no-op — nothing throws, nothing fails to start.
 */
@Component
public class WebhookMetrics implements PendingSignupSweepJob.Metrics {

    private final MeterRegistry registry;

    public WebhookMetrics(ObjectProvider<MeterRegistry> registryProvider) {
        // May be null when actuator/micrometer isn't wired — every method below
        // null-guards, so counters simply become no-ops rather than blowing up
        // the receiver on a metrics-registry failure.
        this.registry = registryProvider.getIfAvailable();
    }

    // -- webhook counters ------------------------------------------------------

    /** {@code razorpay_webhook_total{event=..., outcome=...}}. */
    public void webhookReceived(String event, String outcome) {
        if (registry == null) return;
        Counter.builder("razorpay_webhook_total")
                .description("Razorpay webhooks received, tagged by event type and outcome")
                .tag("event", event == null ? "unknown" : event)
                .tag("outcome", outcome == null ? "unknown" : outcome)
                .register(registry)
                .increment();
    }

    /** {@code razorpay_webhook_signature_failed_total}. */
    public void signatureFailed() {
        if (registry == null) return;
        Counter.builder("razorpay_webhook_signature_failed_total")
                .description("Razorpay webhook payloads whose HMAC signature did not verify")
                .register(registry)
                .increment();
    }

    /** {@code razorpay_webhook_dispatch_error_total}. */
    public void dispatchError() {
        if (registry == null) return;
        Counter.builder("razorpay_webhook_dispatch_error_total")
                .description("Razorpay webhook dispatch handler threw; asked Razorpay to retry")
                .register(registry)
                .increment();
    }

    // -- pending-signup sweep counters (impl of PendingSignupSweepJob.Metrics) --

    @Override public void sweptRecovered() { sweptOutcome("recovered"); }
    @Override public void sweptSkipped()   { sweptOutcome("skipped"); }
    @Override public void sweptNotYet()    { sweptOutcome("not_yet"); }
    @Override public void sweptFailed()    { sweptOutcome("failed"); }

    private void sweptOutcome(String outcome) {
        if (registry == null) return;
        Counter.builder("pending_signup_swept_total")
                .description("Pending-signup recovery sweep outcomes, per row processed")
                .tag("outcome", outcome)
                .register(registry)
                .increment();
    }
}
