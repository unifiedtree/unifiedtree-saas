package com.unifiedtree.saas.payment;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
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

    /**
     * Connect timeout. Razorpay's API is a well-provisioned public endpoint;
     * if we cannot get a socket in 5s the network path is broken, not slow.
     */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    /**
     * Read timeout. MUST be bounded: {@code PlanChangeService.changeSeatCount}
     * calls {@link #updateSubscription} from inside a transaction that holds a
     * {@code pg_advisory_xact_lock} plus a {@code SELECT ... FOR UPDATE} row
     * lock. With the JDK's default infinite read timeout, one hung Razorpay
     * response would pin a Postgres connection and block every other seat
     * change for that tenant indefinitely. 20s is comfortably above Razorpay's
     * observed p99 while capping worst-case lock hold time.
     */
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(20);

    private final RazorpayProperties props;
    private final RestClient http;

    public RazorpayClient(RazorpayProperties props) {
        this.props = props;
        // Explicit request factory for two reasons:
        //
        //  1. The auto-selected default leaves BOTH timeouts infinite (no
        //     httpclient5/jetty/reactor-netty on the classpath), and this
        //     client is called from inside a transaction holding row locks.
        //  2. It MUST support PATCH. SimpleClientHttpRequestFactory is built on
        //     HttpURLConnection, which rejects PATCH outright with
        //     "Invalid HTTP method: PATCH" — so using it silently broke
        //     updateSubscription (Razorpay's update API is PATCH). Adding the
        //     timeouts via that factory and switching the verb to PATCH were
        //     two separate fixes on the same day that cancelled each other out.
        //
        // JdkClientHttpRequestFactory wraps java.net.http.HttpClient, which
        // handles arbitrary verbs and takes a connect timeout on the client
        // plus a read timeout on the factory.
        java.net.http.HttpClient jdkClient = java.net.http.HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(java.net.http.HttpClient.Redirect.NORMAL)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(jdkClient);
        factory.setReadTimeout(READ_TIMEOUT);
        this.http = RestClient.builder()
                .baseUrl(props.apiBase())
                .requestFactory(factory)
                .build();
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

    /** Backwards-compatible overload (no start_at). */
    public SubscriptionView createSubscription(String planId, int quantity, int totalCount,
                                               int customerNotify, Map<String, Object> notes) {
        return createSubscription(planId, quantity, totalCount, customerNotify, null, notes);
    }

    /**
     * Create a Razorpay Subscription against an existing plan.
     *
     * @param planId          Razorpay plan id ("plan_xxx")
     * @param quantity        number of billed seats (multiplier on the per-unit plan price)
     * @param totalCount      how many billing cycles (e.g. 60 for a 5-year cap)
     * @param customerNotify  1 = Razorpay emails/SMS charge notifications; 0 = we handle it
     * @param startAtEpochSec Optional unix-epoch-seconds for when the FIRST charge fires.
     *                        Null → activate immediately on mandate authentication (paid flow).
     *                        Non-null → defer first charge until this instant (trial flow).
     *                        The <b>recurring period</b> (monthly / yearly) is unchanged; this
     *                        only shifts the initial charge — cadence is dictated by the Plan.
     * @param notes           opaque map echoed on webhooks; put our tenant/plan ids here
     * @return {@link SubscriptionView} — id + short_url the customer follows to authorise the mandate
     */
    @SuppressWarnings("unchecked")
    public SubscriptionView createSubscription(String planId, int quantity, int totalCount,
                                               int customerNotify, Long startAtEpochSec,
                                               Map<String, Object> notes) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        // Build the body incrementally — Map.of() cannot hold optional keys.
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("plan_id",         planId);
        body.put("quantity",        quantity);
        body.put("total_count",     totalCount);
        body.put("customer_notify", customerNotify);
        body.put("notes",           notes == null ? Map.of() : notes);
        if (startAtEpochSec != null && startAtEpochSec > 0) {
            body.put("start_at", startAtEpochSec);
        }
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
     * Modify an existing subscription (Hotstar-style seat change / plan swap).
     * Razorpay hits the SAME mandate — no re-authorisation needed as long as
     * the new amount stays under the mandate's max_amount ceiling.
     *
     * @param subscriptionId    Razorpay sub_XXX id
     * @param quantity          new seat count (pass null to leave unchanged)
     * @param planId            switch to a different plan (pass null to leave unchanged)
     * @param scheduleChangeAt  "now" for immediate proration on the current cycle,
     *                          "cycle_end" to defer at next renewal (no proration).
     *                          Null defaults to Razorpay's own default (cycle_end).
     * @param customerNotify    1 = Razorpay emails the buyer about the change; 0 = we own comms.
     * @return the updated {@link SubscriptionView}. Note Razorpay does NOT return
     *         the prorated charge amount here — that materialises asynchronously
     *         via the {@code subscription.charged} webhook once the mandate debits.
     */
    @SuppressWarnings("unchecked")
    public SubscriptionView updateSubscription(String subscriptionId,
                                               Integer quantity,
                                               String planId,
                                               String scheduleChangeAt,
                                               int customerNotify) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway not configured");
        }
        Map<String, Object> body = new java.util.HashMap<>();
        if (quantity != null)         body.put("quantity", quantity);
        if (planId != null)           body.put("plan_id", planId);
        if (scheduleChangeAt != null) body.put("schedule_change_at", scheduleChangeAt);
        body.put("customer_notify", customerNotify);
        try {
            // PATCH, not POST. Razorpay's update-subscription API is
            // `PATCH /v1/subscriptions/:id`; POST on that path matches no route
            // and their gateway answers 404 {"message":"no Route matched with
            // those values"} — which surfaced to customers as a generic 502
            // "Could not update subscription" on every single seat change.
            // (POST is correct for the *sub-resource* actions like
            // /subscriptions/:id/cancel below, which is where the confusion
            // came from.)
            Map<String, Object> resp = http.patch()
                    .uri("/subscriptions/{id}", subscriptionId)
                    .header("Authorization", basicAuthHeader())
                    .header("Content-Type", "application/json")
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            if (resp == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Razorpay returned no subscription");
            }
            return toSubscriptionView(resp);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Razorpay updateSubscription failed: {}", e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Could not update subscription");
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
