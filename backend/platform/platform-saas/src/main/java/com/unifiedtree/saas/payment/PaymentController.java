package com.unifiedtree.saas.payment;

import com.unifiedtree.saas.payment.subscription.SubscriptionService;
import com.unifiedtree.saas.plans.BillingCycle;
import com.unifiedtree.saas.signup.PendingSignupService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

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

    private static final Logger log = LoggerFactory.getLogger(PaymentController.class);

    private final PaymentService payments;
    private final SubscriptionService subscriptions;
    private final PendingSignupService pendingSignups;

    public PaymentController(PaymentService payments, SubscriptionService subscriptions,
                             PendingSignupService pendingSignups) {
        this.payments = payments;
        this.subscriptions = subscriptions;
        this.pendingSignups = pendingSignups;
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
     *
     * <p>B2/D7 (2026-08-14): now REQUIRES a valid, still-AWAITING_MANDATE
     * {@code pendingSignupId}. Previously this endpoint would mint a live
     * Razorpay subscription against ANY caller-supplied plan keys without any
     * link back to the signup flow — a marketing-site preview button became a
     * generic "create paid subscription for anyone" oracle. The endpoint is
     * kept (marketing wants a graceful preview path), but every call must
     * now correspond to a real pending signup row whose plan+seats+cycle
     * match the request. Mismatches or expired/consumed rows are rejected
     * with 400.
     */
    @PostMapping("/create-subscription")
    public CreateSubscriptionResponse createSubscription(@Valid @RequestBody CreateSubscriptionRequest req) {
        UUID pendingId;
        try {
            pendingId = UUID.fromString(req.pendingSignupId());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "pendingSignupId is not a valid UUID");
        }
        Optional<PendingSignupService.PendingSignup> maybe = pendingSignups.findById(pendingId);
        if (maybe.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "pendingSignupId does not match any signup on file");
        }
        PendingSignupService.PendingSignup ps = maybe.get();

        // Must be in the pre-mandate window — never issue a fresh subscription
        // for a signup that already provisioned / failed / cancelled / expired.
        if (!"AWAITING_MANDATE".equals(ps.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "pendingSignup is " + ps.status() + " — cannot start a new payment");
        }
        // Expired window: pending_signups has a 24h expires_at. Refuse rather
        // than let a stale row start Razorpay charges.
        if (ps.expiresAt() != null && ps.expiresAt().isBefore(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "pendingSignup has expired — start signup again");
        }

        // Plan MUST match. Compare normalised (trim+lowercase) sets — the pending
        // row and the request are both allowed to arrive uppercased/whitespaced.
        java.util.Set<String> pendingPlans = normalisePlanKeys(ps.planKeys());
        java.util.Set<String> requestedPlans = normalisePlanKeys(req.planKeys());
        if (!pendingPlans.equals(requestedPlans)) {
            log.warn("create-subscription plan mismatch pending={} request={} (pendingSignup={})",
                    pendingPlans, requestedPlans, pendingId);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Requested plans do not match the pending signup's plans");
        }

        int seats = req.seats() == null ? 1 : req.seats();
        BillingCycle cycle = BillingCycle.from(req.billingCycle());
        SubscriptionService.CreateSubscriptionResult r = subscriptions.createSubscription(
                req.planKeys(), seats, cycle, req.subdomain(), req.email());
        return new CreateSubscriptionResponse(
                r.subscriptionId(), r.shortUrl(), r.razorpayPlanId(),
                r.unitPaise(), r.seats(), r.billingCycle(), r.keyId());
    }

    private static java.util.Set<String> normalisePlanKeys(List<String> keys) {
        if (keys == null) return java.util.Set.of();
        return keys.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(s -> s.trim().toLowerCase(Locale.ROOT))
                .collect(java.util.stream.Collectors.toSet());
    }

    public record CreateSubscriptionRequest(
            @NotEmpty List<String> planKeys,
            @jakarta.validation.constraints.Min(1) Integer seats,
            String billingCycle,   // MONTHLY | ANNUAL
            String subdomain,
            String email,
            @NotBlank String pendingSignupId) {}

    public record CreateSubscriptionResponse(
            String subscriptionId,
            String shortUrl,
            String razorpayPlanId,
            long unitPaise,
            int seats,
            String billingCycle,
            String keyId) {}
}
