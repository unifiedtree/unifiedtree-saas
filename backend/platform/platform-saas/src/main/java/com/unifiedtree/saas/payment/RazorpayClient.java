package com.unifiedtree.saas.payment;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

/**
 * Thin, dependency-free Razorpay REST client. We deliberately avoid the
 * razorpay-java SDK and call the HTTP API directly so every request/verification
 * is auditable and we control failure handling for a LIVE (real-money) key.
 *
 * <p>Two security-critical operations:
 * <ol>
 *   <li>{@link #verifyPaymentSignature} — HMAC-SHA256(order_id|payment_id) with
 *       the key secret, constant-time compared to the client-supplied signature.
 *       This is what proves a payment callback is genuine and untampered.</li>
 *   <li>{@link #fetchPayment} — server-side confirmation that Razorpay actually
 *       captured/authorized the payment for the expected amount. Never trust the
 *       client's word that a payment succeeded.</li>
 * </ol>
 */
@Component
public class RazorpayClient {

    private static final Logger log = LoggerFactory.getLogger(RazorpayClient.class);

    private final RazorpayProperties props;
    private final RestClient http;

    public RazorpayClient(RazorpayProperties props) {
        this.props = props;
        this.http = RestClient.builder().baseUrl(props.apiBase()).build();
    }

    private String basicAuthHeader() {
        String raw = props.keyId() + ":" + props.keySecret();
        return "Basic " + Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Create a Razorpay order. amountPaise is rupees * 100. Returns the order id
     * ({@code order_xxx}) the frontend hands to Razorpay Checkout.
     */
    @SuppressWarnings("unchecked")
    public String createOrder(long amountPaise, String receipt, Map<String, Object> notes) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        Map<String, Object> body = Map.of(
                "amount", amountPaise,
                "currency", "INR",
                "receipt", receipt,
                "payment_capture", 1,          // auto-capture on success
                "notes", notes == null ? Map.of() : notes);
        try {
            Map<String, Object> resp = http.post()
                    .uri("/orders")
                    .header("Authorization", basicAuthHeader())
                    .header("Content-Type", "application/json")
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            if (resp == null || resp.get("id") == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Razorpay returned no order id");
            }
            return String.valueOf(resp.get("id"));
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Razorpay createOrder failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not create payment order");
        }
    }

    /**
     * Verify the checkout signature. Razorpay signs {@code order_id|payment_id}
     * with the key secret (HMAC-SHA256, hex). Returns true only on an exact,
     * constant-time match.
     */
    public boolean verifyPaymentSignature(String orderId, String paymentId, String signature) {
        if (orderId == null || paymentId == null || signature == null
                || orderId.isBlank() || paymentId.isBlank() || signature.isBlank()) {
            return false;
        }
        String expected = hmacSha256Hex(orderId + "|" + paymentId, props.keySecret());
        return constantTimeEquals(expected, signature.trim());
    }

    /**
     * Fetch a payment from Razorpay to confirm it was really captured/authorized
     * and for how much. Returns a small view; throws 402/502 on problems.
     */
    @SuppressWarnings("unchecked")
    public PaymentView fetchPayment(String paymentId) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        try {
            Map<String, Object> resp = http.get()
                    .uri("/payments/{id}", paymentId)
                    .header("Authorization", basicAuthHeader())
                    .retrieve()
                    .body(Map.class);
            if (resp == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Razorpay returned no payment");
            }
            String status = String.valueOf(resp.get("status"));
            long amountPaise = ((Number) resp.getOrDefault("amount", 0)).longValue();
            String orderId = resp.get("order_id") == null ? null : String.valueOf(resp.get("order_id"));
            return new PaymentView(paymentId, orderId, status, amountPaise);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Razorpay fetchPayment failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not verify payment");
        }
    }

    /** A captured or authorized payment is "good" for our purposes. */
    public record PaymentView(String paymentId, String orderId, String status, long amountPaise) {
        public boolean isPaid() {
            return "captured".equalsIgnoreCase(status) || "authorized".equalsIgnoreCase(status);
        }
    }

    // ============================================================================
    //  SUBSCRIPTIONS (autopay) — Razorpay Plans + Subscriptions API
    // ============================================================================
    //
    //  Flow:
    //    1) createPlan(...)         — one-time per (module_key, billing_cycle);
    //                                 result cached in platform.razorpay_plans.
    //    2) createSubscription(...) — per signup. Returns a subscription id and
    //                                 a short_url the customer follows to
    //                                 approve the mandate (UPI Autopay / card).
    //    3) fetchSubscription(...)  — server-side confirmation after checkout.
    //    4) cancelSubscription(...) — from the workspace's subscription panel.
    //    5) verifyWebhookSignature  — HMAC-SHA256 over the raw JSON body with
    //                                 RAZORPAY_WEBHOOK_SECRET, delivered in
    //                                 the X-Razorpay-Signature header.
    //  Razorpay-side auto-retries on a failed charge: 4 attempts over 4 days
    //  before the subscription is moved to "halted". Our grace-period timer
    //  starts from that halted event, not from the first failure.

    /**
     * Create a Razorpay Plan object. amountPaise is per-charge (per-seat *
     * seats-if-quantity=1; we set quantity per subscription instead so the
     * Plan is a pure "one unit per seat per period" object).
     *
     * @param period        "monthly" or "yearly"
     * @param interval      1 for every period, 2 for every-other, etc.
     * @param amountPaise   per-seat charge, in paise
     * @param name          human label (shown in Razorpay dashboard, not to the buyer)
     * @param notes         opaque map echoed back on webhooks; use for our keys
     */
    @SuppressWarnings("unchecked")
    public String createPlan(String period, int interval, long amountPaise, String name,
                             Map<String, Object> notes) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        Map<String, Object> item = Map.of(
                "name",     name,
                "amount",   amountPaise,
                "currency", "INR");
        Map<String, Object> body = Map.of(
                "period",   period,
                "interval", interval,
                "item",     item,
                "notes",    notes == null ? Map.of() : notes);
        try {
            Map<String, Object> resp = http.post()
                    .uri("/plans")
                    .header("Authorization", basicAuthHeader())
                    .header("Content-Type", "application/json")
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            if (resp == null || resp.get("id") == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Razorpay returned no plan id");
            }
            return String.valueOf(resp.get("id"));
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Razorpay createPlan failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not create Razorpay plan");
        }
    }

    /**
     * Create a Razorpay Subscription against an existing plan.
     *
     * @param planId          Razorpay plan id ("plan_xxx")
     * @param quantity        number of billed seats (multiplier on the per-unit plan price)
     * @param totalCount      how many billing cycles (e.g. 60 for a 5-year cap)
     * @param customerNotify  1 = Razorpay emails/SMS charge notifications; 0 = we handle it
     * @param notes           opaque map echoed on webhooks; put our tenant/plan ids here
     * @return {@link SubscriptionView} — id + short_url the customer follows to authorise the mandate
     */
    @SuppressWarnings("unchecked")
    public SubscriptionView createSubscription(String planId, int quantity, int totalCount,
                                               int customerNotify, Map<String, Object> notes) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        Map<String, Object> body = Map.of(
                "plan_id",         planId,
                "quantity",        quantity,
                "total_count",     totalCount,
                "customer_notify", customerNotify,
                "notes",           notes == null ? Map.of() : notes);
        try {
            Map<String, Object> resp = http.post()
                    .uri("/subscriptions")
                    .header("Authorization", basicAuthHeader())
                    .header("Content-Type", "application/json")
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            if (resp == null || resp.get("id") == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Razorpay returned no subscription id");
            }
            return toSubscriptionView(resp);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Razorpay createSubscription failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not create Razorpay subscription");
        }
    }

    /** Server-side confirmation of a subscription's current state. */
    @SuppressWarnings("unchecked")
    public SubscriptionView fetchSubscription(String subscriptionId) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        try {
            Map<String, Object> resp = http.get()
                    .uri("/subscriptions/{id}", subscriptionId)
                    .header("Authorization", basicAuthHeader())
                    .retrieve()
                    .body(Map.class);
            if (resp == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Razorpay returned no subscription");
            }
            return toSubscriptionView(resp);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Razorpay fetchSubscription failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not fetch subscription");
        }
    }

    /**
     * Cancel a Razorpay subscription. {@code cancelAtCycleEnd=true} lets the
     * customer finish out the period they've already paid for; false cancels
     * immediately.
     */
    @SuppressWarnings("unchecked")
    public SubscriptionView cancelSubscription(String subscriptionId, boolean cancelAtCycleEnd) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        try {
            Map<String, Object> resp = http.post()
                    .uri("/subscriptions/{id}/cancel", subscriptionId)
                    .header("Authorization", basicAuthHeader())
                    .header("Content-Type", "application/json")
                    .body(Map.of("cancel_at_cycle_end", cancelAtCycleEnd ? 1 : 0))
                    .retrieve()
                    .body(Map.class);
            if (resp == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Razorpay returned no subscription");
            }
            return toSubscriptionView(resp);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Razorpay cancelSubscription failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not cancel subscription");
        }
    }

    /**
     * Verify a webhook signature. Razorpay signs the RAW request body with
     * RAZORPAY_WEBHOOK_SECRET (HMAC-SHA256, hex). Callers MUST pass the raw
     * bytes exactly as received — any re-serialisation of a JSON body will
     * change whitespace and break the HMAC.
     */
    public boolean verifyWebhookSignature(byte[] rawBody, String signatureHeader) {
        if (rawBody == null || signatureHeader == null || signatureHeader.isBlank()) return false;
        if (!props.isWebhookConfigured()) return false;
        String expected = hmacSha256HexBytes(rawBody, props.webhookSecret());
        return constantTimeEquals(expected, signatureHeader.trim());
    }

    /** Small view over the Razorpay subscription response. */
    public record SubscriptionView(String id, String planId, String status,
                                   String shortUrl, Long currentStart, Long currentEnd,
                                   Long chargeAt, String paymentMethod) {}

    private static SubscriptionView toSubscriptionView(Map<String, Object> resp) {
        String id       = str(resp, "id");
        String planId   = str(resp, "plan_id");
        String status   = str(resp, "status");
        String shortUrl = str(resp, "short_url");
        Long start      = longOrNull(resp, "current_start");
        Long end        = longOrNull(resp, "current_end");
        Long chargeAt   = longOrNull(resp, "charge_at");
        String method   = str(resp, "payment_method");
        return new SubscriptionView(id, planId, status, shortUrl, start, end, chargeAt, method);
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : String.valueOf(v);
    }
    private static Long longOrNull(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v instanceof Number ? ((Number) v).longValue() : null;
    }

    private static String hmacSha256HexBytes(byte[] data, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] raw = mac.doFinal(data);
            StringBuilder sb = new StringBuilder(raw.length * 2);
            for (byte b : raw) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("HMAC computation failed", e);
        }
    }

    // -- crypto helpers ---------------------------------------------------------

    private static String hmacSha256Hex(String data, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] raw = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(raw.length * 2);
            for (byte b : raw) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("HMAC computation failed", e);
        }
    }

    /** Length-constant comparison to avoid timing side channels on the signature. */
    private static boolean constantTimeEquals(String a, String b) {
        byte[] x = a.getBytes(StandardCharsets.UTF_8);
        byte[] y = b.getBytes(StandardCharsets.UTF_8);
        if (x.length != y.length) return false;
        int r = 0;
        for (int i = 0; i < x.length; i++) r |= x[i] ^ y[i];
        return r == 0;
    }
}
