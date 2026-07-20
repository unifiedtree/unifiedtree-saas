package com.unifiedtree.saas.payment;

import com.unifiedtree.saas.plans.BillingCycle;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;

/**
 * Public checkout endpoints for paid workspace signup.
 *
 * <p>Flow: the website calls {@code POST /create-order} with the chosen plan
 * keys, opens Razorpay Checkout with the returned order, then submits the
 * signup (with the payment proof) to {@code POST /v1/public/signup-request},
 * which verifies the payment before creating the workspace.
 */
@RestController
@RequestMapping("/v1/public/payment")
public class PaymentController {

    private final PaymentService payments;

    public PaymentController(PaymentService payments) {
        this.payments = payments;
    }

    /** Whether the paywall is active — lets the website decide the CTA copy. */
    @GetMapping("/config")
    public PaymentConfigResponse config() {
        return new PaymentConfigResponse(payments.paywallActive());
    }

    @PostMapping("/create-order")
    public CreateOrderResponse createOrder(@Valid @RequestBody CreateOrderRequest req) {
        int seats = req.seats() == null ? 1 : req.seats();
        BillingCycle cycle = BillingCycle.from(req.billingCycle());
        PaymentService.CreateOrderResult r = payments.createOrder(req.planKeys(), seats, cycle, req.subdomain(), req.email());
        return new CreateOrderResponse(r.orderId(), r.amountInr(), r.seats(),
                r.billingCycle(), r.periodMonths(), r.currency(), r.keyId());
    }

    public record CreateOrderRequest(
            @NotEmpty List<String> planKeys,
            @jakarta.validation.constraints.Min(1) Integer seats,   // number of users (billed at per-seat price)
            String billingCycle,                                    // MONTHLY | ANNUAL (default MONTHLY)
            String subdomain,
            String email) {}

    public record CreateOrderResponse(
            String orderId,
            BigDecimal amountInr,
            int seats,
            String billingCycle,
            int periodMonths,
            String currency,
            String keyId) {}

    public record PaymentConfigResponse(boolean paywallActive) {}
}
