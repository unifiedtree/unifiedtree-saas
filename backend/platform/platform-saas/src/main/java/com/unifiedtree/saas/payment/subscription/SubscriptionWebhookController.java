package com.unifiedtree.saas.payment.subscription;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
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

    public SubscriptionWebhookController(JdbcTemplate jdbc, RazorpayClient razorpay, RazorpayProperties props) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.props = props;
    }

    /**
     * Receive a Razorpay webhook. Reads the raw body (bytes) so signature
     * verification sees exactly what Razorpay signed — Jackson binding on a
     * POJO would strip/reformat whitespace and break the HMAC.
     */
    @PostMapping(value = "/razorpay", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> receive(@RequestBody byte[] rawBody,
                                          @RequestHeader(value = "X-Razorpay-Signature", required = false)
                                          String signature) {
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

        String eventId = optText(root, "id");                          // "evt_xxx" — Razorpay's event id
        String eventType = optText(root, "event");                     // e.g. "subscription.charged"
        JsonNode subNode = root.path("payload").path("subscription").path("entity");
        String subscriptionId = subNode.isMissingNode() ? null : optText(subNode, "id");

        if (eventId == null || eventType == null) {
            log.warn("Webhook missing id/event — accepting silently to prevent retries");
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
            dispatch(eventType, subscriptionId, subNode);
        } catch (Exception e) {
            // Log & swallow — the event is already in the ledger. Do NOT 5xx
            // back to Razorpay (they'd retry and hit the idempotency guard,
            // meaning we'd never re-attempt this specific event). A separate
            // reconciliation job (future) can walk unprocessed ledger rows.
            log.error("Webhook dispatch failed for {} {}: {}", eventType, subscriptionId, e.getMessage(), e);
        }
        return ResponseEntity.ok("ok");
    }

    private void dispatch(String eventType, String subscriptionId, JsonNode subNode) {
        if (subscriptionId == null) {
            log.info("Webhook {} has no subscription id; ignoring", eventType);
            return;
        }
        switch (eventType) {
            case "subscription.activated", "subscription.charged", "subscription.resumed" -> onActive(subscriptionId, subNode);
            case "subscription.pending"    -> onPending(subscriptionId, subNode);
            case "subscription.halted"     -> onHalted(subscriptionId);
            case "subscription.completed"  -> onCompleted(subscriptionId);
            case "subscription.cancelled"  -> onCancelled(subscriptionId);
            case "subscription.paused"     -> onPaused(subscriptionId);
            default -> log.debug("Webhook {} — no handler wired; ledger row kept", eventType);
        }
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
