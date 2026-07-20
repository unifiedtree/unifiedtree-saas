package com.unifiedtree.saas.payment;

import com.unifiedtree.saas.plans.ModulePlanDto;
import com.unifiedtree.saas.plans.ModulePlanService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Orchestrates the paid-signup checkout against Razorpay.
 *
 * <p>Security model (this is a LIVE money path):
 * <ul>
 *   <li>The order amount is computed SERVER-SIDE from {@code module_plans},
 *       never accepted from the client.</li>
 *   <li>A paid order is only honoured after BOTH the checkout HMAC signature
 *       verifies AND a server-to-server {@code fetchPayment} confirms Razorpay
 *       captured the expected amount.</li>
 *   <li>A single order can create exactly one workspace: once CONSUMED it is
 *       rejected. This blocks replay of a valid payment into many free tenants.</li>
 * </ul>
 */
@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    private final JdbcTemplate jdbc;
    private final RazorpayClient razorpay;
    private final RazorpayProperties props;
    private final ModulePlanService planService;

    public PaymentService(JdbcTemplate jdbc,
                          RazorpayClient razorpay,
                          RazorpayProperties props,
                          ModulePlanService planService) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.props = props;
        this.planService = planService;
    }

    public boolean paywallActive() {
        return props.isConfigured();
    }

    // -- 1. create order -------------------------------------------------------

    public CreateOrderResult createOrder(List<String> planKeys, int seats, String subdomain, String email) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment gateway is not configured");
        }
        int billedSeats = Math.max(1, seats);
        List<ModulePlanDto> plans = planService.requireAvailable(planKeys);
        BigDecimal amountInr = planService.totalPriceInr(plans, billedSeats);   // Rs 40/user * seats
        if (amountInr.signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Selected plans have no payable amount");
        }
        long amountPaise = amountInr.multiply(BigDecimal.valueOf(100)).longValueExact();

        UUID paymentRowId = UUID.randomUUID();
        String receipt = "ws_" + paymentRowId.toString().substring(0, 18);
        List<String> normKeys = plans.stream().map(ModulePlanDto::key).toList();

        String orderId = razorpay.createOrder(amountPaise, receipt, Map.of(
                "subdomain", subdomain == null ? "" : subdomain,
                "email", email == null ? "" : email,
                "seats", String.valueOf(billedSeats),
                "plans", String.join(",", normKeys)));

        jdbc.update("""
                INSERT INTO platform.payments
                    (id, razorpay_order_id, amount_inr, seats, currency, status, plan_keys, subdomain, contact_email, created_at)
                VALUES (?, ?, ?, ?, 'INR', 'CREATED', ?, ?, ?, now())
                """,
                paymentRowId, orderId, amountInr, billedSeats,
                normKeys.toArray(new String[0]),
                subdomain == null ? null : subdomain.trim().toLowerCase(Locale.ROOT),
                email == null ? null : email.trim().toLowerCase(Locale.ROOT));

        if (props.isLive()) {
            log.info("Razorpay LIVE order created {} for Rs {} ({} seats) plans={}",
                    orderId, amountInr, billedSeats, normKeys);
        }
        return new CreateOrderResult(orderId, amountInr, billedSeats, "INR", props.keyId());
    }

    // -- 2. verify a paid order (called during signup) -------------------------

    /**
     * Verify signature + server-side capture for an order, mark it PAID, and
     * return the validated record. Does NOT consume it — the caller consumes it
     * only after the workspace row is written.
     */
    public PaidOrder verifyPaid(String orderId, String paymentId, String signature) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment gateway is not configured");
        }
        PaymentRow row = loadByOrderId(orderId);
        if ("CONSUMED".equals(row.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This payment has already been used to create a workspace");
        }

        // (a) checkout signature must be genuine
        if (!razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
            throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED, "Payment signature invalid");
        }

        // (b) server-to-server confirmation that Razorpay actually took the money
        RazorpayClient.PaymentView pv = razorpay.fetchPayment(paymentId);
        if (!pv.isPaid()) {
            throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                    "Payment not captured (status=" + pv.status() + ")");
        }
        if (pv.orderId() != null && !pv.orderId().equals(orderId)) {
            throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED, "Payment does not match this order");
        }
        long expectedPaise = row.amountInr().multiply(BigDecimal.valueOf(100)).longValueExact();
        if (pv.amountPaise() < expectedPaise) {
            throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED, "Paid amount is less than expected");
        }

        jdbc.update("""
                UPDATE platform.payments
                   SET status = 'PAID', razorpay_payment_id = ?, signature_verified = TRUE, paid_at = now()
                 WHERE razorpay_order_id = ? AND status <> 'CONSUMED'
                """, paymentId, orderId);

        return new PaidOrder(row.id(), orderId, paymentId, row.amountInr(), row.planKeys());
    }

    // -- 3. consume the order once the workspace exists ------------------------

    public void markConsumed(String orderId, UUID tenantId) {
        jdbc.update("""
                UPDATE platform.payments
                   SET status = 'CONSUMED', tenant_id = ?, consumed_at = now()
                 WHERE razorpay_order_id = ?
                """, tenantId, orderId);
    }

    // -- helpers ---------------------------------------------------------------

    private PaymentRow loadByOrderId(String orderId) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, amount_inr, status, plan_keys
                      FROM platform.payments
                     WHERE razorpay_order_id = ?
                    """, (rs, n) -> {
                java.sql.Array arr = rs.getArray("plan_keys");
                List<String> keys = arr != null ? List.of((String[]) arr.getArray()) : List.of();
                return new PaymentRow(
                        UUID.fromString(rs.getString("id")),
                        rs.getBigDecimal("amount_inr"),
                        rs.getString("status"),
                        keys);
            }, orderId);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED, "Unknown payment order");
        }
    }

    public record CreateOrderResult(String orderId, BigDecimal amountInr, int seats, String currency, String keyId) {}

    public record PaidOrder(UUID id, String orderId, String paymentId, BigDecimal amountInr, List<String> planKeys) {}

    private record PaymentRow(UUID id, BigDecimal amountInr, String status, List<String> planKeys) {}
}
