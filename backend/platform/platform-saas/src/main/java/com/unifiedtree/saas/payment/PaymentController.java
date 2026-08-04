package com.unifiedtree.saas.payment;

import com.unifiedtree.saas.payment.subscription.SubscriptionService;
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
    private final SubscriptionService subscriptions;

    public PaymentController(PaymentService payments, SubscriptionService subscriptions) {
        this.payments = payments;
        this.subscriptions = subscriptions;
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

    // -- 2. autopay (Razorpay Subscriptions) ---------------------------------

    /**
     * Create a Razorpay subscription and return its id + the short_url the
     * customer follows to authorise the mandate (UPI Autopay / card 2FA).
     * The ledger row on {@code platform.subscriptions} is written by the
     * webhook handler once Razorpay confirms activation.
     */
    @PostMapping("/create-subscription")
    public CreateSubscriptionResponse createSubscription(@Valid @RequestBody CreateSubscriptionRequest req) {
        int seats = req.seats() == null ? 1 : req.seats();
        BillingCycle cycle = BillingCycle.from(req.billingCycle());
        SubscriptionService.CreateSubscriptionResult r = subscriptions.createSubscription(
                req.planKeys(), seats, cycle, req.subdomain(), req.email());
        return new CreateSubscriptionResponse(
                r.subscriptionId(), r.shortUrl(), r.razorpayPlanId(),
                r.unitPaise(), r.seats(), r.billingCycle(), r.keyId());
    }

    public record CreateSubscriptionRequest(
            @NotEmpty List<String> planKeys,
            @jakarta.validation.constraints.Min(1) Integer seats,
            String billingCycle,   // MONTHLY | ANNUAL
            String subdomain,
            String email) {}

    public record CreateSubscriptionResponse(
            String subscriptionId,
            String shortUrl,
            String razorpayPlanId,
            long unitPaise,
            int seats,
            String billingCycle,
            String keyId) {}
}
