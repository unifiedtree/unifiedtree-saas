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
