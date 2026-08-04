package com.unifiedtree.saas.payment.subscription;

import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.plans.BillingCycle;
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

/**
 * Autopay / recurring-billing orchestrator against the Razorpay Subscriptions API.
 *
 * <p>Coexists with {@link com.unifiedtree.saas.payment.PaymentService} — that
 * service handles the one-time Orders flow, this one handles subscriptions.
 * A signup request picks between the two by setting {@code mode = ONE_TIME | AUTO_RENEW}.
 *
 * <p>How Razorpay Plans + Subscriptions map to our world:
 * <ul>
 *   <li>One Razorpay Plan per {@code (module_key, billing_cycle)} tuple —
 *       e.g. {@code (hr-employees, MONTHLY)}. Cached in
 *       {@code platform.razorpay_plans}; created lazily on first use.</li>
 *   <li>One Razorpay Subscription per signup, with {@code quantity = seats}.
 *       This means a {@code 10-seat} signup becomes ONE subscription that
 *       charges {@code plan.unit_price * 10} on each cycle — Razorpay handles
 *       the multiplication.</li>
 *   <li>Multi-module signups: the current build creates ONE subscription for
 *       the primary plan only. Multi-plan bundling requires either
 *       (a) a summed synthetic Plan created on the fly, or (b) N parallel
 *       Razorpay subscriptions. Left as a follow-up — right now the paid
 *       catalog has a single AVAILABLE plan (HR bundle), so this doesn't
 *       block launch.</li>
 * </ul>
 */
@Service
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    /** Razorpay caps total_count based on period. 60 monthly cycles = 5 years. */
    private static final int TOTAL_COUNT_MONTHLY = 60;
    /** 10 annual cycles = 10 years — plenty for a subscription that renews yearly. */
    private static final int TOTAL_COUNT_ANNUAL = 10;

    private final JdbcTemplate jdbc;
    private final RazorpayClient razorpay;
    private final RazorpayProperties props;
    private final ModulePlanService planService;

    public SubscriptionService(JdbcTemplate jdbc,
                               RazorpayClient razorpay,
                               RazorpayProperties props,
                               ModulePlanService planService) {
        this.jdbc = jdbc;
        this.razorpay = razorpay;
        this.props = props;
        this.planService = planService;
    }

    // -- 1. create subscription ------------------------------------------------

    /**
     * Create a Razorpay subscription for the buyer to authorise. Returns the
     * subscription id + the {@code short_url} they follow to approve the
     * mandate (UPI Autopay / card 2FA). No ledger row is written yet — that
     * happens on {@code subscription.activated} webhook, after Razorpay
     * confirms the mandate was authorised.
     *
     * @param planKeys  MUST currently be a single-plan list; multi-plan bundling
     *                  is a follow-up (see class javadoc).
     */
    public CreateSubscriptionResult createSubscription(List<String> planKeys, int seats,
                                                       BillingCycle cycle,
                                                       String subdomain, String email) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Payment gateway is not configured");
        }
        if (planKeys == null || planKeys.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "At least one plan is required");
        }
        if (planKeys.size() > 1) {
            // Guard rather than silently subscribe to only the first plan. When
            // we take on a paid catalog with more than one plan, add the
            // multi-plan bundling path here.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Autopay currently supports one plan per subscription");
        }
        BillingCycle c = cycle == null ? BillingCycle.MONTHLY : cycle;
        int billedSeats = Math.max(1, seats);
        String moduleKey = planKeys.get(0);

        // Server-authoritative plan lookup — never accept the price from the client.
        List<ModulePlanDto> plans = planService.requireAvailable(List.of(moduleKey));
        ModulePlanDto plan = plans.get(0);
        BigDecimal unitPerCyclePerSeat = planService.effectiveMonthlyUnit(plan, c);
        if (unitPerCyclePerSeat.signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Selected plan has no payable amount");
        }
        // For annual, the "unit" is the discounted monthly rate * 12 — one
        // Razorpay charge per year. Razorpay stores per-charge amounts.
        long unitPaise = c == BillingCycle.ANNUAL
                ? unitPerCyclePerSeat.multiply(BigDecimal.valueOf(1200)).longValueExact()   // *12 months *100 paise
                : unitPerCyclePerSeat.multiply(BigDecimal.valueOf(100)).longValueExact();

        String rzpPlanId = ensureRazorpayPlan(moduleKey, c, plan.displayName(), unitPaise);

        int totalCount = c == BillingCycle.ANNUAL ? TOTAL_COUNT_ANNUAL : TOTAL_COUNT_MONTHLY;
        RazorpayClient.SubscriptionView view = razorpay.createSubscription(
                rzpPlanId, billedSeats, totalCount, /*customerNotify=*/ 1,
                Map.of(
                        "subdomain",   subdomain == null ? "" : subdomain,
                        "email",       email == null ? "" : email,
                        "plan_key",    moduleKey,
                        "cycle",       c.name(),
                        "seats",       String.valueOf(billedSeats)));

        if (props.isLive()) {
            log.info("Razorpay LIVE subscription created {} plan={} seats={} cycle={} unitPaise={}",
                    view.id(), rzpPlanId, billedSeats, c.name(), unitPaise);
        }
        return new CreateSubscriptionResult(
                view.id(), view.shortUrl(), rzpPlanId,
                unitPaise, billedSeats, c.name(),
                props.keyId());
    }

    // -- 2. Razorpay Plan cache -----------------------------------------------

    /**
     * Return the Razorpay plan id for a {@code (moduleKey, billing_cycle)} tuple,
     * creating and persisting one if we don't have it. Idempotent: a race that
     * inserts twice will hit the UNIQUE(module_key, billing_cycle) constraint;
     * we swallow that and read the winner.
     */
    private String ensureRazorpayPlan(String moduleKey, BillingCycle cycle, String moduleName,
                                      long unitPaise) {
        String existing = findRazorpayPlanId(moduleKey, cycle);
        if (existing != null) return existing;

        String period = cycle == BillingCycle.ANNUAL ? "yearly" : "monthly";
        String name = String.format(Locale.ROOT, "UnifiedTree — %s (%s)", moduleName, cycle.name());
        String rzpPlanId = razorpay.createPlan(period, 1, unitPaise, name,
                Map.of("module_key", moduleKey, "cycle", cycle.name()));

        try {
            jdbc.update("""
                    INSERT INTO platform.razorpay_plans
                        (module_key, billing_cycle, razorpay_plan_id, unit_price_paise, currency)
                    VALUES (?, ?, ?, ?, 'INR')
                    ON CONFLICT (module_key, billing_cycle) DO NOTHING
                    """, moduleKey, cycle.name(), rzpPlanId, unitPaise);
        } catch (Exception e) {
            // Race — some other request beat us to it. Read the winner.
            log.warn("Race inserting razorpay_plans row: {}", e.getMessage());
        }
        String stored = findRazorpayPlanId(moduleKey, cycle);
        return stored != null ? stored : rzpPlanId;
    }

    private String findRazorpayPlanId(String moduleKey, BillingCycle cycle) {
        try {
            return jdbc.queryForObject("""
                    SELECT razorpay_plan_id FROM platform.razorpay_plans
                     WHERE module_key = ? AND billing_cycle = ?
                    """, String.class, moduleKey, cycle.name());
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    // -- 3. cancel -------------------------------------------------------------

    /**
     * Cancel a subscription. {@code cancelAtCycleEnd=true} = customer keeps
     * the period they've paid for; false = cancel immediately (and Razorpay
     * refunds the unused portion where applicable).
     */
    public void cancel(String razorpaySubscriptionId, boolean cancelAtCycleEnd) {
        razorpay.cancelSubscription(razorpaySubscriptionId, cancelAtCycleEnd);
        jdbc.update("""
                UPDATE platform.subscriptions
                   SET status = 'CANCELLED', updated_at = now()
                 WHERE razorpay_subscription_id = ? AND status <> 'CANCELLED'
                """, razorpaySubscriptionId);
        log.info("Subscription {} cancelled (cancelAtCycleEnd={})", razorpaySubscriptionId, cancelAtCycleEnd);
    }

    public record CreateSubscriptionResult(String subscriptionId, String shortUrl, String razorpayPlanId,
                                           long unitPaise, int seats, String billingCycle, String keyId) {}
}
