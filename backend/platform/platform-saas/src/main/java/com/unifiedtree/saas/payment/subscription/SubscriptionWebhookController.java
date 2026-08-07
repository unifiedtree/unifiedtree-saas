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

    public SubscriptionWebhookController(JdbcTemplate jdbc, RazorpayClient razorpay, RazorpayProperties props,
                                         PendingSignupService pending,
                                         MandateProvisioningService provisioning) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.props = props;
        this.pending = pending;
        this.provisioning = provisioning;
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

        if (eventId == null || eventType == null) {
            log.warn("Webhook missing id/event — eventIdHeader={} eventInBody={} — accepting silently",
                    eventIdHeader, eventType);
            return ResponseEntity.accepted().body("ignored");
        }

        // Idempotency: PK insert wins the race; second delivery gets DataIntegrityViolationException.
        try {
            jdbc.update("""
                    INSERT INTO platform.razorpay_webhook_events
                        (event_id, event_type, subscription_id, payload, received_at)
                    VALUES (?, ?, ?, CAST(? AS JSONB), ?)
                    """, eventId, eventType, subscriptionId, new String(rawBody), Timestamp.from(Instant.now()));
        } catch (DataIntegrityViolationException e) {
            log.info("Duplicate webhook {} ({}); ignoring", eventId, eventType);
            return ResponseEntity.ok("duplicate");
        }

        try {
            dispatch(eventType, subscriptionId, subNode, payNode);
        } catch (Exception e) {
            // Log & swallow — the event is already in the ledger. Do NOT 5xx
            // back to Razorpay (they'd retry and hit the idempotency guard,
            // meaning we'd never re-attempt this specific event). A separate
            // reconciliation job (future) can walk unprocessed ledger rows.
            log.error("Webhook dispatch failed for {} {}: {}", eventType, subscriptionId, e.getMessage(), e);
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
                    onActive(subscriptionId, subNode);
                }
            }
            case "subscription.pending" -> { if (subscriptionId != null) onPending(subscriptionId, subNode); }
            case "subscription.halted"  -> {
                if (subscriptionId != null) {
                    onHalted(subscriptionId);
                    // 7-day grace before workspace read-only lock — same policy
                    // for trial-to-paid conversion failure and normal renewal
                    // failure.
                    provisioning.applyGrace(subscriptionId, Instant.now());
                }
            }
            case "subscription.completed" -> { if (subscriptionId != null) onCompleted(subscriptionId); }
            case "subscription.cancelled" -> {
                if (subscriptionId != null) {
                    onCancelled(subscriptionId);
                    // If a mandate is cancelled BEFORE provisioning, mark the
                    // pending row too so its subdomain reservation releases.
                    pending.findByRazorpaySubscriptionId(subscriptionId)
                           .filter(p -> "AWAITING_MANDATE".equals(p.status()))
                           .ifPresent(p -> pending.markCancelled(p.id()));
                }
            }
            case "subscription.paused"    -> { if (subscriptionId != null) onPaused(subscriptionId); }

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
     * Resolve the pending signup for this Razorpay subscription and hand it
     * to {@link MandateProvisioningService#provisionFromPending}.
     *
     * <p>Primary key: {@code razorpay_subscription_id} on pending_signups
     * (unique). Fallback: {@code notes.pending_signup_id} on the entity
     * payload (in case a proxy stripped {@code notes} — unlikely, but
     * belt-and-suspenders). Idempotent — pending row's status guard blocks
     * a second workspace on replay.
     */
    private void tryProvision(String subscriptionId, JsonNode subNode, String triggerEvent) {
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

    private void onActive(String subscriptionId, JsonNode subNode) {
        Long currentEnd = optLong(subNode, "current_end");
        Long chargeAt   = optLong(subNode, "charge_at");
        String method   = optText(subNode, "payment_method");
        int rows = jdbc.update("""
                UPDATE platform.subscriptions SET
                    status         = 'ACTIVE',
                    halted_at      = NULL,
                    current_period_end = COALESCE(to_timestamp(?), current_period_end),
                    next_charge_at = to_timestamp(?),
                    payment_method = COALESCE(?, payment_method),
                    updated_at     = now()
                 WHERE razorpay_subscription_id = ?
                """, currentEnd, chargeAt, method, subscriptionId);
        if (rows == 0) log.info("Webhook active for {} — no ledger row yet (activation before signup write)", subscriptionId);
        else log.info("Subscription {} -> ACTIVE (nextCharge={}, method={})", subscriptionId, chargeAt, method);
    }

    private void onPending(String subscriptionId, JsonNode subNode) {
        Long chargeAt = optLong(subNode, "charge_at");
        jdbc.update("""
                UPDATE platform.subscriptions SET
                    status = 'PAST_DUE',
                    next_charge_at = to_timestamp(?),
                    updated_at = now()
                 WHERE razorpay_subscription_id = ?
                """, chargeAt, subscriptionId);
        log.info("Subscription {} -> PAST_DUE (Razorpay retrying charge)", subscriptionId);
    }

    private void onHalted(String subscriptionId) {
        // Razorpay exhausted its own retries. Start the 7-day grace timer;
        // the grace-period job flips workspace access to read-only on day 8.
        jdbc.update("""
                UPDATE platform.subscriptions SET
                    status     = 'HALTED',
                    halted_at  = COALESCE(halted_at, now()),
                    updated_at = now()
                 WHERE razorpay_subscription_id = ?
                """, subscriptionId);
        log.warn("Subscription {} -> HALTED (grace period timer started)", subscriptionId);
    }

    private void onCompleted(String subscriptionId) {
        jdbc.update("""
                UPDATE platform.subscriptions SET
                    status     = 'COMPLETED',
                    updated_at = now()
                 WHERE razorpay_subscription_id = ?
                """, subscriptionId);
        log.info("Subscription {} -> COMPLETED (all charges done)", subscriptionId);
    }

    private void onCancelled(String subscriptionId) {
        jdbc.update("""
                UPDATE platform.subscriptions SET
                    status     = 'CANCELLED',
                    updated_at = now()
                 WHERE razorpay_subscription_id = ?
                """, subscriptionId);
        log.info("Subscription {} -> CANCELLED", subscriptionId);
    }

    private void onPaused(String subscriptionId) {
        jdbc.update("""
                UPDATE platform.subscriptions SET
                    status     = 'PAUSED',
                    updated_at = now()
                 WHERE razorpay_subscription_id = ?
                """, subscriptionId);
        log.info("Subscription {} -> PAUSED", subscriptionId);
    }

    private static String optText(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private static Long optLong(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asLong();
    }
}
