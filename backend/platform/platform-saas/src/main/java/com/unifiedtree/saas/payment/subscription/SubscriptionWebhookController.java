package com.unifiedtree.saas.payment.subscription;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.signup.MandateProvisioningService;
import com.unifiedtree.saas.signup.PendingSignupService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Razorpay webhook receiver. One endpoint, verifies HMAC signature, dispatches
 * subscription.* events.
 *
 * <p>Reliability contract:
 * <ul>
 *   <li>Return 2xx quickly (Razorpay retries on non-2xx for 24 hours).</li>
 *   <li>Idempotent by Razorpay event id — {@code platform.razorpay_webhook_events}
 *       is the ledger; a duplicate delivery hits the PK and is dropped as a
 *       "202 already-processed" instead of double-updating our state.</li>
 *   <li>Unknown/uninteresting event types are ACKed silently so Razorpay
 *       doesn't retry them.</li>
 * </ul>
 *
 * <p>Configure the endpoint URL and shared secret in the Razorpay dashboard:
 * <pre>
 *   URL:    https://api.unifiedtree.com/api/v1/webhooks/razorpay
 *   Secret: set as RAZORPAY_WEBHOOK_SECRET in Google Secret Manager
 *   Events: subscription.activated, subscription.charged, subscription.completed,
 *           subscription.pending, subscription.halted, subscription.cancelled,
 *           subscription.paused, subscription.resumed
 * </pre>
 */
@RestController
@RequestMapping("/v1/webhooks")
public class SubscriptionWebhookController {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionWebhookController.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final JdbcTemplate jdbc;
    private final RazorpayClient razorpay;
    private final RazorpayProperties props;
    private final PendingSignupService pending;
    private final MandateProvisioningService provisioning;
    private final PlanChangeService planChanges;
    private final SubscriptionStateReconciler reconciler;

    public SubscriptionWebhookController(JdbcTemplate jdbc, RazorpayClient razorpay, RazorpayProperties props,
                                         PendingSignupService pending,
                                         MandateProvisioningService provisioning,
                                         PlanChangeService planChanges,
                                         SubscriptionStateReconciler reconciler) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.props = props;
        this.pending = pending;
        this.provisioning = provisioning;
        this.planChanges = planChanges;
        this.reconciler = reconciler;
    }

    /**
     * Receive a Razorpay webhook. Reads the raw body (bytes) so signature
     * verification sees exactly what Razorpay signed — Jackson binding on a
     * POJO would strip/reformat whitespace and break the HMAC.
     */
    @PostMapping(value = "/razorpay", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> receive(@RequestBody byte[] rawBody,
                                          @RequestHeader(value = "X-Razorpay-Signature", required = false)
                                          String signature,
                                          @RequestHeader(value = "X-Razorpay-Event-Id", required = false)
                                          String eventIdHeader) {
        if (!props.isWebhookConfigured()) {
            log.warn("Webhook received but RAZORPAY_WEBHOOK_SECRET is not configured; refusing");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body("webhook not configured");
        }
        if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
            log.warn("Webhook signature verification FAILED (sig hdr present={})", signature != null);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("bad signature");
        }

        JsonNode root;
        try {
            root = MAPPER.readTree(rawBody);
        } catch (IOException e) {
            log.warn("Webhook body not JSON: {}", e.getMessage());
            return ResponseEntity.badRequest().body("bad body");
        }

        // Razorpay's actual webhook body does NOT carry a top-level `id`. The
        // unique event id lives in the X-Razorpay-Event-Id HEADER. We tried
        // body.id first as a fallback (some proxies / test rigs re-serialise
        // and injecting it into the body is a common pattern), but the
        // authoritative source is the header.
        String eventId = eventIdHeader != null && !eventIdHeader.isBlank()
                ? eventIdHeader
                : optText(root, "id");
        String eventType = optText(root, "event");                     // e.g. "subscription.charged" / "payment.captured"
        // Subscription events carry payload.subscription.entity; payment events
        // carry payload.payment.entity. Peek both and let dispatch decide.
        JsonNode subNode = root.path("payload").path("subscription").path("entity");
        JsonNode payNode = root.path("payload").path("payment").path("entity");
        String subscriptionId = subNode.isMissingNode() ? null : optText(subNode, "id");

        if (eventType == null) {
            // No event type means we cannot dispatch — return 400 so Razorpay
            // retries (safe: their client will also see this in the delivery
            // log). Never 202-accept an unparseable event; Razorpay only
            // retries on non-2xx and a 202 would lose the event forever.
            log.warn("Webhook missing event type — eventIdHeader={} — rejecting to force retry",
                    eventIdHeader);
            return ResponseEntity.badRequest().body("missing event type");
        }
        if (eventId == null) {
            // Header stripped by an upstream proxy / test rig. Derive a stable
            // synthetic id from the signed rawBody so idempotency still works
            // (a re-delivery has identical bytes and hashes the same). We
            // MUST NOT 202-drop here — verify caught this: a lost halted
            // event means the customer's grace clock never starts and they
            // hit the day-7 lockout with no email warning.
            try {
                java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
                byte[] d = md.digest(rawBody);
                StringBuilder sb = new StringBuilder(64);
                for (byte b : d) sb.append(String.format("%02x", b));
                eventId = "syn_" + sb.substring(0, 40);
                log.warn("Webhook missing X-Razorpay-Event-Id — using synthetic id {} for {} (proxy strip?)",
                        eventId, eventType);
            } catch (java.security.NoSuchAlgorithmException nsae) {
                // SHA-256 is required by every JVM; unreachable.
                throw new IllegalStateException("SHA-256 unavailable", nsae);
            }
        }

        // B2 FIX (2026-08-14) — DISPATCH-BEFORE-INSERT so Razorpay can retry.
        //
        // Previous ordering INSERTed the event row FIRST, then dispatched. If
        // dispatch threw (Postgres blip, RLS not set, downstream 500) the row
        // was already committed, so a retry would hit the PK and 202-drop —
        // the event was permanently swallowed. That's how the
        // "webhook-dispatch-failure-permanently-lost" bug lost live
        // subscription.charged / .halted events.
        //
        // New ordering:
        //   1. Signature-verify + parse (already done above).
        //   2. Idempotency-CHECK-BEFORE-dispatch via a SELECT — a real
        //      re-delivery of a previously-successful event still short-
        //      circuits so we don't double-provision.
        //   3. Dispatch. If it throws, return 500 so Razorpay retries; do
        //      NOT write the ledger row (the retry will re-check step 2 and
        //      re-attempt dispatch).
        //   4. On success, INSERT the ledger row. A rare race where two
        //      instances win step 2 simultaneously and both dispatch is
        //      caught by the PK unique constraint here; the loser logs and
        //      still ACKs 200 (dispatch already happened once).

        // Step 2: idempotency check (replay-safe read).
        Integer already = jdbc.queryForObject(
                "SELECT count(*) FROM platform.razorpay_webhook_events WHERE event_id = ?",
                Integer.class, eventId);
        if (already != null && already > 0) {
            log.info("Duplicate webhook {} ({}); already processed, ignoring", eventId, eventType);
            return ResponseEntity.ok("duplicate");
        }

        // Step 3: dispatch. If it throws, refuse the ACK so Razorpay retries.
        try {
            dispatch(eventType, subscriptionId, subNode, payNode);
        } catch (Exception e) {
            log.error("Webhook dispatch FAILED for {} {} (id={}); returning 500 so Razorpay retries: {}",
                    eventType, subscriptionId, eventId, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("dispatch failed; will retry");
        }

        // Step 4: only NOW record the event as processed. A concurrent duplicate
        // that also passed step 2 loses the PK race here; treat that as a
        // benign duplicate rather than 5xx.
        try {
            jdbc.update("""
                    INSERT INTO platform.razorpay_webhook_events
                        (event_id, event_type, subscription_id, payload, received_at)
                    VALUES (?, ?, ?, CAST(? AS JSONB), ?)
                    """, eventId, eventType, subscriptionId, new String(rawBody), Timestamp.from(Instant.now()));
        } catch (DataIntegrityViolationException e) {
            log.info("Webhook {} ({}): concurrent duplicate INSERT lost the PK race after successful dispatch; ok",
                    eventId, eventType);
        }
        return ResponseEntity.ok("ok");
    }

    private void dispatch(String eventType, String subscriptionId, JsonNode subNode, JsonNode payNode) {
        switch (eventType) {
            // Subscription lifecycle (autopay path)
            case "subscription.authenticated" -> {
                // TRIAL: this is the workspace-creation trigger (start_at is 7 days
                // out so no charge yet). PAID: does not fire when start_at is null;
                // if it does, provisioning is still correct (we always want the
                // workspace created as soon as the mandate is in place).
                if (subscriptionId != null) tryProvision(subscriptionId, subNode, "subscription.authenticated");
            }
            case "subscription.activated", "subscription.charged", "subscription.resumed" -> {
                if (subscriptionId != null) {
                    // PAID flow lands here first (no start_at, so activated fires
                    // as soon as the first charge succeeds). If we have not
                    // provisioned yet from an earlier authenticated event, do it
                    // now — idempotent by pending_signup_id.
                    tryProvision(subscriptionId, subNode, eventType);
                    // Delegates to SubscriptionStateReconciler so the guard +
                    // reconciliation cron write identical row shapes.
                    // onActive now ALSO clears grace_until (no more stale
                    // grace landmine on halt→active→halt bounces).
                    reconciler.onActive(subscriptionId, subNode);
                }
            }
            case "subscription.pending" -> { if (subscriptionId != null) reconciler.onPending(subscriptionId, subNode); }
            case "subscription.halted"  -> {
                if (subscriptionId != null) {
                    // onHalted stamps status='HALTED' AND sets grace_until =
                    // now+7d unconditionally (bounces get a fresh window each
                    // time). Grace lockout is enforced at request-time by
                    // SubscriptionAccessGuard which now double-checks with
                    // Razorpay before returning 402 in case we missed a charge.
                    reconciler.onHalted(subscriptionId);
                }
            }
            case "subscription.completed" -> { if (subscriptionId != null) reconciler.onCompleted(subscriptionId); }
            case "subscription.cancelled" -> {
                if (subscriptionId != null) {
                    reconciler.onCancelled(subscriptionId);
                    // If a mandate is cancelled BEFORE provisioning, mark the
                    // pending row too so its subdomain reservation releases.
                    pending.findByRazorpaySubscriptionId(subscriptionId)
                           .filter(p -> "AWAITING_MANDATE".equals(p.status()))
                           .ifPresent(p -> pending.markCancelled(p.id()));
                    // Same for in-workspace plan-change requests — they
                    // hold no subdomain reservation but the CANCELLED status
                    // keeps the UI polling honest.
                    planChanges.findByRazorpaySubscriptionId(subscriptionId)
                            .filter(p -> "AWAITING_MANDATE".equals(p.status()))
                            .ifPresent(p -> planChanges.markCancelled(p.id()));
                }
            }
            case "subscription.paused"    -> { if (subscriptionId != null) reconciler.onPaused(subscriptionId); }
            case "subscription.updated"   -> {
                // Mid-cycle changes made via Razorpay dashboard (seat count,
                // plan swap, quantity edit). Sync payload into our ledger so
                // tenant_modules.seats + platform.subscriptions.seats don't
                // drift. Status stays whatever the accompanying event set —
                // this handler is refresh-only.
                if (subscriptionId != null) reconciler.onUpdated(subscriptionId, subNode);
            }

            // One-time payment lifecycle (safety net for the Orders flow —
            // browser callback usually reaches us first via PaymentService.verifyPaid,
            // but if the tab crashed between capture and signup submit these events
            // let us reconcile stuck orders.)
            case "payment.captured" -> onPaymentCaptured(payNode);
            case "payment.failed"   -> onPaymentFailed(payNode);
            case "order.paid"       -> log.info("Order {} fully paid (webhook)", optText(payNode, "order_id"));

            default -> log.debug("Webhook {} — no handler wired; ledger row kept", eventType);
        }
    }

    /**
     * Resolve the pending intent for this Razorpay subscription and route
     * it to the right service:
     * <ul>
     *   <li>{@code plan_change_requests} row → in-workspace autopay setup,
     *       activate modules on the EXISTING tenant via
     *       {@link PlanChangeService#activate}.</li>
     *   <li>{@code pending_signups} row → new-workspace signup, provision
     *       via {@link MandateProvisioningService#provisionFromPending}.</li>
     * </ul>
     * The two tables never collide on razorpay_subscription_id (Razorpay
     * ids are globally unique), so first-match wins deterministically.
     *
     * <p>Fallback: {@code notes.pending_signup_id} on the entity payload for
     * both paths — belt-and-suspenders against a proxy stripping {@code notes}.
     * Idempotent — each service's status guard blocks a second run on replay.
     */
    private void tryProvision(String subscriptionId, JsonNode subNode, String triggerEvent) {
        // 1. In-workspace plan-change first — this is the "existing tenant
        //    adds modules" path (Phase 3 of the 2026-08-07 client asks).
        Optional<PlanChangeService.PlanChangeRequest> pcr =
                planChanges.findByRazorpaySubscriptionId(subscriptionId);
        if (pcr.isEmpty()) {
            String fromNotes = optText(subNode.path("notes"), "pending_signup_id");
            if (fromNotes != null) {
                try {
                    pcr = planChanges.findById(UUID.fromString(fromNotes));
                } catch (IllegalArgumentException ignored) { }
            }
        }
        if (pcr.isPresent()) {
            planChanges.activate(pcr.get().id());
            return;
        }

        // 2. Fresh-workspace signup — the original webhook target.
        Optional<PendingSignupService.PendingSignup> row =
                pending.findByRazorpaySubscriptionId(subscriptionId);
        if (row.isEmpty()) {
            String fromNotes = optText(subNode.path("notes"), "pending_signup_id");
            if (fromNotes != null) {
                try {
                    row = pending.findById(UUID.fromString(fromNotes));
                } catch (IllegalArgumentException ignored) {
                    // malformed UUID in notes — treat as no match
                }
            }
        }
        if (row.isEmpty()) {
            log.debug("Webhook {} for subscription {} — no pending row (may be a subscription created outside our flow)",
                    triggerEvent, subscriptionId);
            return;
        }
        provisioning.provisionFromPending(row.get().id(), subNode, triggerEvent);
    }

    // -- one-time payment safety-net handlers ---------------------------------

    private void onPaymentCaptured(JsonNode payNode) {
        if (payNode == null || payNode.isMissingNode()) return;
        String orderId   = optText(payNode, "order_id");
        String paymentId = optText(payNode, "id");
        if (orderId == null || paymentId == null) return;

        // Flip CREATED -> PAID as a safety net. If the browser flow already
        // consumed this order into a workspace (status='CONSUMED'), the WHERE
        // clause protects us; the row is already handled and we don't touch it.
        int rows = jdbc.update("""
                UPDATE platform.payments
                   SET status = 'PAID',
                       razorpay_payment_id = COALESCE(razorpay_payment_id, ?),
                       signature_verified  = TRUE,
                       paid_at = COALESCE(paid_at, now())
                 WHERE razorpay_order_id = ? AND status = 'CREATED'
                """, paymentId, orderId);
        if (rows > 0) {
            log.info("Payment {} captured (webhook safety net) — order {} marked PAID", paymentId, orderId);
        } else {
            log.debug("Payment {} captured — order {} already {} (webhook is redundant)", paymentId, orderId,
                    "PAID or CONSUMED");
        }
    }

    private void onPaymentFailed(JsonNode payNode) {
        if (payNode == null || payNode.isMissingNode()) return;
        String orderId   = optText(payNode, "order_id");
        String paymentId = optText(payNode, "id");
        String reason    = optText(payNode, "error_description");
        // Deliberately do NOT flip the ledger row to a FAILED state — the user
        // can still retry with a different payment method against the same
        // order id. Just log for observability + let ops notice via the audit
        // trail in razorpay_webhook_events.
        log.warn("Payment {} failed on order {} — reason: {}", paymentId, orderId, reason);
    }

    // NOTE: onActive/onPending/onHalted/onCompleted/onCancelled/onPaused/
    // onUpdated moved to SubscriptionStateReconciler @Service — same SQL
    // shapes now used by the webhook controller, the request-time access
    // guard, and the reconciliation cron so all three writers cannot drift.

    private static String optText(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static Long optLong(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asLong();
    }
}
