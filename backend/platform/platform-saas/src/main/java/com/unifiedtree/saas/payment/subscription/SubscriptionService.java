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
import java.time.Instant;
import java.util.HashMap;
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
        return createSubscription(planKeys, seats, cycle, subdomain, email, null, null);
    }

    /**
     * Extended overload used by the unified signup flow.
     *
     * @param startAt          non-null → Razorpay defers the first charge until
     *                         this instant (used for the 7-day trial). null →
     *                         first charge fires immediately when the mandate
     *                         is authorised (paid signup).
     * @param pendingSignupId  UUID of the platform.pending_signups row this
     *                         subscription belongs to. Serialised into
     *                         Razorpay's opaque `notes` map so the webhook can
     *                         find the pending row on activation. Optional
     *                         (null-safe) for callers that don't need it.
     *
     * <p><b>Cadence guarantee</b>: {@code period} is <i>always</i> monthly or
     * yearly (never weekly). {@code startAt} shifts the FIRST charge only; the
     * recurring cycle stays monthly/annual. Trial + monthly = charge on day 8,
     * next on day ~38, next on day ~68 — never every 7 days.
     */
    public CreateSubscriptionResult createSubscription(List<String> planKeys, int seats,
                                                       BillingCycle cycle,
                                                       String subdomain, String email,
                                                       Instant startAt,
                                                       String pendingSignupId) {
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

        // Notes echoed back on every webhook event. Include everything the
        // webhook may need to correlate: primary key (pending_signup_id),
        // human context (subdomain/email/cycle), and price/plan for audits.
        Map<String, Object> notes = new HashMap<>();
        notes.put("subdomain",   subdomain == null ? "" : subdomain);
        notes.put("email",       email == null ? "" : email);
        notes.put("plan_key",    moduleKey);
        notes.put("cycle",       c.name());
        notes.put("seats",       String.valueOf(billedSeats));
        if (pendingSignupId != null && !pendingSignupId.isBlank()) {
            notes.put("pending_signup_id", pendingSignupId);
        }

        int totalCount = c == BillingCycle.ANNUAL ? TOTAL_COUNT_ANNUAL : TOTAL_COUNT_MONTHLY;
        // Razorpay wants seconds-since-epoch. Passing null tells the client to
        // omit start_at, so the subscription becomes active as soon as the
        // customer authenticates the mandate (paid flow).
        Long startAtEpoch = startAt == null ? null : startAt.getEpochSecond();

        RazorpayClient.SubscriptionView view = razorpay.createSubscription(
                rzpPlanId, billedSeats, totalCount, /*customerNotify=*/ 1,
                startAtEpoch, notes);

        if (props.isLive()) {
            log.info("Razorpay LIVE subscription created {} plan={} seats={} cycle={} unitPaise={} startAt={}",
                    view.id(), rzpPlanId, billedSeats, c.name(), unitPaise, startAtEpoch);
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

    // -- 2b. update (Hotstar-style seat change) --------------------------------

    /**
     * Change the seat count on an existing Razorpay subscription — the same
     * mandate the customer already authorised is reused. Razorpay charges the
     * prorated difference on the current cycle (schedule_change_at="now") and
     * bills the new full amount from the next renewal.
     *
     * <p>The async prorated charge lands as a {@code subscription.charged}
     * webhook; our reconciler's {@code onActive} updates {@code current_period_end}
     * and {@code amount_inr} from that webhook. This method only makes the
     * Razorpay call — the caller ({@link PlanChangeService#changeSeatCount})
     * updates our local {@code tenant_modules.seats} + {@code platform.subscriptions}
     * ledger to reflect the intent.
     */
    public QuantityChange updateQuantity(String razorpaySubscriptionId, int newSeats) {
        if (newSeats < 1 || newSeats > 999) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Seat count must be between 1 and 999");
        }
        // Ask Razorpay what state the subscription is actually in before
        // deciding how to change it. Our own ledger says ACTIVE from the
        // moment the mandate is authorised, but Razorpay distinguishes:
        //
        //   authenticated -> mandate approved, FIRST CHARGE NOT YET TAKEN.
        //                    This is every workspace inside its 7-day free
        //                    trial. No cycle has begun, so there is nothing to
        //                    prorate; asking for schedule_change_at="now"
        //                    charges a difference against a cycle that does
        //                    not exist. The new seat count should simply be
        //                    what the first charge bills.
        //   active        -> money has been taken for the current cycle, so a
        //                    seat increase genuinely owes a prorated top-up.
        //
        // Sending "now" unconditionally was wrong for the trial case, which is
        // where most seat changes will happen — a customer sizing their team
        // during the free week.
        RazorpayClient.SubscriptionView current;
        try {
            current = razorpay.fetchSubscription(razorpaySubscriptionId);
        } catch (RuntimeException e) {
            // Do not guess. Proration is a money decision; if we cannot read
            // the state, refuse rather than risk charging against the wrong
            // assumption.
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Could not read your subscription from Razorpay. Please try again in a moment.");
        }
        String upstream = String.valueOf(current.status()).toLowerCase(java.util.Locale.ROOT);
        String method   = current.paymentMethod() == null
                ? "" : current.paymentMethod().toLowerCase(java.util.Locale.ROOT);

        // UPI mandates CANNOT be modified. Razorpay rejects any update to a
        // UPI-backed subscription outright:
        //   400 "subscriptions cannot be updated when payment mode is upi"
        // A UPI Autopay mandate is authorised once, for a fixed maximum, and
        // is immutable thereafter — there is no API that changes it, so no
        // amount of retrying or re-shaping the request will help. Changing the
        // seat count on UPI means cancelling this mandate and authorising a
        // new one, which the customer must do themselves in their UPI app.
        //
        // This matters far more here than it would elsewhere: UPI is the
        // default way Indian SMBs pay, so this is the COMMON path, not an edge
        // case. Fail with a specific, actionable message rather than letting
        // the caller surface a bare 502.
        if (method.contains("upi")) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "UPI_MANDATE_IMMUTABLE: Your autopay is set up through UPI, and UPI mandates "
                    + "cannot be changed once approved — that is a restriction from the payment "
                    + "network, not from us. To change your seat count, cancel your current autopay "
                    + "and set it up again for the new number of seats. Nothing is charged twice.");
        }
        // Razorpay also refuses updates outside these two states (e.g. a
        // mandate the customer never finished authorising).
        if (!("authenticated".equals(upstream) || "active".equals(upstream))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Your autopay is not in a state that can be changed (currently " + upstream
                    + "). Please complete or re-authorise your mandate first.");
        }
        boolean chargedYet = "active".equals(upstream);
        String scheduleChangeAt = chargedYet ? "now" : null;

        razorpay.updateSubscription(
                razorpaySubscriptionId,
                newSeats,
                /*planId*/ null,
                scheduleChangeAt,
                /*customerNotify*/ 1);

        log.info("Razorpay subscription {} quantity -> {} (upstream={}, proration={})",
                razorpaySubscriptionId, newSeats, upstream, chargedYet ? "now" : "at first charge");
        return new QuantityChange(newSeats, chargedYet, upstream);
    }

    /**
     * @param proratedNow true when Razorpay will charge the difference against
     *                    the current cycle immediately; false when the
     *                    subscription has not been charged yet (free trial) and
     *                    the new count simply applies to the first charge.
     */
    public record QuantityChange(int newSeats, boolean proratedNow, String upstreamStatus) {}

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

    /**
     * Cancel a subscription that is still in the pre-mandate state
     * ("created" or "authenticated"), before any workspace was provisioned.
     * Used by the abandonment sweep and by the endpoint when an intent is
     * abandoned. Idempotent — a Razorpay error (e.g. already cancelled) is
     * logged rather than raised because there is no ledger row to keep in
     * sync yet.
     */
    public void cancelPreAuth(String razorpaySubscriptionId) {
        if (razorpaySubscriptionId == null || razorpaySubscriptionId.isBlank()) return;
        try {
            razorpay.cancelSubscription(razorpaySubscriptionId, /*cancelAtCycleEnd=*/ false);
            log.info("Pre-auth subscription {} cancelled", razorpaySubscriptionId);
        } catch (Exception e) {
            log.warn("cancelPreAuth({}) — Razorpay refused (probably already cancelled): {}",
                    razorpaySubscriptionId, e.getMessage());
        }
    }

    public record CreateSubscriptionResult(String subscriptionId, String shortUrl, String razorpayPlanId,
                                           long unitPaise, int seats, String billingCycle, String keyId) {}
}
