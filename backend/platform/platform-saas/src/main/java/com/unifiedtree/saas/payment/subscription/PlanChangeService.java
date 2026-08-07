package com.unifiedtree.saas.payment.subscription;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * In-workspace autopay setup — the "add modules to an EXISTING tenant"
 * counterpart to {@link com.unifiedtree.saas.signup.PendingSignupService}.
 *
 * <p>Flow (mirrors the signup one so the webhook has a single dispatch shape):
 * <ol>
 *   <li>Admin submits {@code POST /v1/workspace/plan/setup-autopay} with
 *       {@code items=[{planKey, seats}, ...]} and {@code billingCycle}.</li>
 *   <li>{@link #create} validates the items (all AVAILABLE, exactly one plan
 *       until multi-plan bundling ships in SubscriptionService), calls
 *       {@link SubscriptionService#createSubscription} for the mandate, and
 *       stashes the intent in {@code platform.plan_change_requests}.</li>
 *   <li>Razorpay webhook receives {@code subscription.activated}. The
 *       webhook controller resolves the plan-change row by
 *       {@code razorpay_subscription_id} and calls
 *       {@link #activate}, which writes
 *       {@code platform.tenant_modules} rows (with the seat counts) +
 *       one {@code platform.subscriptions} ledger row on the existing tenant.</li>
 * </ol>
 *
 * <p>All writes go via ut_app (the runtime role) — never elevated privileges.
 * The plan_change_requests table was granted CRUD to ut_app in the
 * corresponding migration script.
 */
@Service
public class PlanChangeService {

    private static final Logger log = LoggerFactory.getLogger(PlanChangeService.class);
    private static final long TRIAL_DAYS = 7L;
    private static final ObjectMapper OM = new ObjectMapper();

    private final JdbcTemplate jdbc;
    private final SubscriptionService subscriptions;
    private final ModulePlanService planService;

    public PlanChangeService(JdbcTemplate jdbc,
                             SubscriptionService subscriptions,
                             ModulePlanService planService) {
        this.jdbc = jdbc;
        this.subscriptions = subscriptions;
        this.planService = planService;
    }

    // -- create --------------------------------------------------------------

    /**
     * Create a plan-change request for an EXISTING tenant. The Razorpay
     * subscription is created here (so the caller gets the {@code short_url}
     * to authorise) but the tenant_modules rows aren't written until the
     * mandate is authenticated and the webhook fires {@link #activate}.
     *
     * <p>Includes a 7-day free trial by delaying the Razorpay subscription's
     * {@code start_at}, matching the per-workspace-trial semantic the client
     * asked for on 2026-08-07 ("still 7-day free trial ... only starts when
     * autopay is set up").
     */
    public CreateResult create(UUID tenantId, UUID initiatorAccountId,
                               List<PlanItem> items, BillingCycle cycle,
                               String subdomain, String email) {
        if (items == null || items.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Select at least one module (with a seat count).");
        }
        // Validate: only AVAILABLE plans, positive seats, no duplicates.
        List<String> planKeys = items.stream().map(PlanItem::planKey).distinct().toList();
        if (planKeys.size() != items.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "The same plan can't appear twice in one request.");
        }
        for (PlanItem it : items) {
            if (it.seats() < 1 || it.seats() > 999) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Seat count for " + it.planKey() + " must be between 1 and 999.");
            }
        }
        // Fail fast on LAUNCHING_SOON / unknown keys BEFORE we hit Razorpay.
        List<ModulePlanDto> validated = planService.requireAvailable(planKeys);
        if (validated.size() != planKeys.size()) {
            // requireAvailable throws on any bad key; belt-and-suspenders.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "One or more selected plans are not available.");
        }
        // SubscriptionService currently supports one plan per subscription.
        // If more than one is requested, refuse cleanly rather than silently
        // subscribing to just the first.
        if (planKeys.size() > 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Autopay currently supports one paid plan per workspace. Pick one to start.");
        }

        BillingCycle c = cycle == null ? BillingCycle.MONTHLY : cycle;
        PlanItem it = items.get(0);

        // Persist the intent BEFORE calling Razorpay so we have a stable id
        // to put in the subscription notes. Row starts AWAITING_MANDATE with
        // razorpay_subscription_id null; we fill it in after createSubscription.
        UUID pendingId = UUID.randomUUID();
        String plansJson = toJson(items);

        jdbc.update("""
                INSERT INTO platform.plan_change_requests
                    (id, tenant_id, initiator_account_id, plan_items, billing_cycle,
                     status, created_at, updated_at)
                VALUES (?, ?, ?, ?::jsonb, ?, 'AWAITING_MANDATE', now(), now())
                """,
                pendingId, tenantId, initiatorAccountId,
                plansJson,
                c == BillingCycle.ANNUAL ? "yearly" : "monthly");

        SubscriptionService.CreateSubscriptionResult rzp;
        try {
            rzp = subscriptions.createSubscription(
                    List.of(it.planKey()), it.seats(), c,
                    subdomain, email,
                    java.time.Instant.now().plusSeconds(TRIAL_DAYS * 24 * 3600),
                    pendingId.toString());   // notes.pending_signup_id — webhook fallback
        } catch (RuntimeException rex) {
            // Razorpay call failed — mark the intent CANCELLED so it doesn't
            // sit as AWAITING_MANDATE forever. The Razorpay side was never
            // created (no subscription id to clean up).
            jdbc.update("""
                    UPDATE platform.plan_change_requests
                       SET status = 'CANCELLED', failure_reason = ?, updated_at = now()
                     WHERE id = ?
                    """, "razorpay createSubscription failed: " + rex.getMessage(), pendingId);
            throw rex;
        }

        // Wire the Razorpay subscription id back onto the row so the webhook
        // can find us on activation. If this UPDATE races with an
        // already-arrived subscription.activated (network re-ordering), the
        // webhook falls back to notes.pending_signup_id from the Razorpay
        // payload — same pattern SubscriptionSignupController uses.
        jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET razorpay_subscription_id = ?, checkout_short_url = ?, updated_at = now()
                 WHERE id = ?
                """, rzp.subscriptionId(), rzp.shortUrl(), pendingId);

        log.info("plan-change created tenant={} account={} pending={} rzpSub={} plan={} seats={} cycle={}",
                tenantId, initiatorAccountId, pendingId, rzp.subscriptionId(),
                it.planKey(), it.seats(), c);

        return new CreateResult(pendingId, rzp.subscriptionId(), rzp.shortUrl(), rzp.keyId());
    }

    // -- activate (called from the webhook) ---------------------------------

    /**
     * Activate the modules requested by a plan-change on the tenant. Called
     * from the Razorpay webhook after subscription.activated. Idempotent:
     * calling twice with the same request id is a no-op after the first
     * successful run (the row's status flips to ACTIVATED and the second
     * call short-circuits).
     */
    public void activate(UUID planChangeRequestId) {
        Row r = requireRow(planChangeRequestId);
        if ("ACTIVATED".equals(r.status)) {
            log.info("plan-change {} already ACTIVATED — webhook re-delivery, skipping.", planChangeRequestId);
            return;
        }
        if (!"AWAITING_MANDATE".equals(r.status)) {
            log.warn("plan-change {} not in AWAITING_MANDATE (status={}), skipping activation.",
                    planChangeRequestId, r.status);
            return;
        }

        List<PlanItem> items = fromJson(r.planItemsJson);
        // Expand every plan's included_modules and upsert tenant_modules ACTIVE
        // rows with the requested seat count. ON CONFLICT keeps existing rows
        // (they were selected before) but bumps their seats to the new value.
        for (PlanItem it : items) {
            List<ModulePlanDto> plans = planService.requireAvailable(List.of(it.planKey()));
            List<String> catalogKeys = planService.expandModules(plans);
            for (String moduleKey : catalogKeys) {
                jdbc.update("""
                        INSERT INTO platform.tenant_modules
                            (id, tenant_id, module_key, status, seats,
                             requested_at, approved_at, activated_at)
                        VALUES (?, ?, ?, 'ACTIVE', ?, now(), now(), now())
                        ON CONFLICT (tenant_id, module_key) DO UPDATE
                            SET status = 'ACTIVE',
                                seats  = EXCLUDED.seats,
                                activated_at = COALESCE(platform.tenant_modules.activated_at, now())
                        """,
                        UUID.randomUUID(), r.tenantId, moduleKey, it.seats());
            }
        }

        jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET status = 'ACTIVATED', activated_at = now(), updated_at = now()
                 WHERE id = ?
                """, planChangeRequestId);

        log.info("plan-change {} ACTIVATED on tenant {} — {} plan(s) applied",
                planChangeRequestId, r.tenantId, items.size());
    }

    public void markFailed(UUID id, String reason) {
        jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET status = 'FAILED', failure_reason = ?, updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, reason, id);
    }

    public void markCancelled(UUID id) {
        jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET status = 'CANCELLED', updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, id);
    }

    // -- reads ---------------------------------------------------------------

    public Optional<PlanChangeRequest> findById(UUID id) {
        try {
            Row r = jdbc.queryForObject("""
                    SELECT id, tenant_id, initiator_account_id, plan_items::text AS plan_items,
                           billing_cycle, razorpay_subscription_id, status,
                           failure_reason, activated_at
                      FROM platform.plan_change_requests
                     WHERE id = ?
                    """, this::mapRow, id);
            return Optional.of(toDto(r));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    /** Called from the webhook when Razorpay resolves a subscription id → row. */
    public Optional<PlanChangeRequest> findByRazorpaySubscriptionId(String rzpSubId) {
        if (rzpSubId == null || rzpSubId.isBlank()) return Optional.empty();
        try {
            Row r = jdbc.queryForObject("""
                    SELECT id, tenant_id, initiator_account_id, plan_items::text AS plan_items,
                           billing_cycle, razorpay_subscription_id, status,
                           failure_reason, activated_at
                      FROM platform.plan_change_requests
                     WHERE razorpay_subscription_id = ?
                     LIMIT 1
                    """, this::mapRow, rzpSubId);
            return Optional.of(toDto(r));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    // -- helpers -------------------------------------------------------------

    private Row requireRow(UUID id) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, tenant_id, initiator_account_id, plan_items::text AS plan_items,
                           billing_cycle, razorpay_subscription_id, status,
                           failure_reason, activated_at
                      FROM platform.plan_change_requests
                     WHERE id = ?
                    """, this::mapRow, id);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown plan-change request " + id);
        }
    }

    private Row mapRow(java.sql.ResultSet rs, int rowNum) throws SQLException {
        Row r = new Row();
        r.id = UUID.fromString(rs.getString("id"));
        r.tenantId = UUID.fromString(rs.getString("tenant_id"));
        r.initiatorAccountId = UUID.fromString(rs.getString("initiator_account_id"));
        r.planItemsJson = rs.getString("plan_items");
        r.billingCycle = rs.getString("billing_cycle");
        r.razorpaySubscriptionId = rs.getString("razorpay_subscription_id");
        r.status = rs.getString("status");
        r.failureReason = rs.getString("failure_reason");
        return r;
    }

    private PlanChangeRequest toDto(Row r) {
        return new PlanChangeRequest(
                r.id, r.tenantId, r.initiatorAccountId,
                fromJson(r.planItemsJson),
                r.billingCycle, r.razorpaySubscriptionId,
                r.status, r.failureReason);
    }

    private static String toJson(List<PlanItem> items) {
        try {
            return OM.writeValueAsString(items);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialise plan items", e);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<PlanItem> fromJson(String json) {
        try {
            return OM.readValue(json, OM.getTypeFactory().constructCollectionType(List.class, PlanItem.class));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse plan_items JSON: " + json, e);
        }
    }

    // -- DTOs ---------------------------------------------------------------

    public record PlanItem(String planKey, int seats) {}

    public record CreateResult(UUID planChangeRequestId, String razorpaySubscriptionId,
                               String checkoutShortUrl, String keyId) {}

    public record PlanChangeRequest(
            UUID id, UUID tenantId, UUID initiatorAccountId,
            List<PlanItem> items, String billingCycle,
            String razorpaySubscriptionId,
            String status, String failureReason) {}

    private static class Row {
        UUID id;
        UUID tenantId;
        UUID initiatorAccountId;
        String planItemsJson;
        String billingCycle;
        String razorpaySubscriptionId;
        String status;
        String failureReason;
    }
}
