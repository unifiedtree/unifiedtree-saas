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
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
     *
     * <p><b>@Transactional is REQUIRED.</b> TenantAwareDataSource sets every
     * leased connection to autoCommit=false whenever TenantContext is set
     * (so SET LOCAL app.tenant_id survives inside the transaction). Without
     * a Spring transaction boundary, the INSERT completes without error but
     * is silently ROLLED BACK when the connection returns to the pool and
     * Hikari resets autoCommit to true. This bug ate a live customer's setup
     * attempt on 2026-08-07 — the log printed "plan-change created" (INSERT
     * succeeded) but the row vanished seconds later. Same class of bug as
     * dabf88a on MandateProvisioningService, opposite direction: there we
     * had to REMOVE @Transactional because it started BEFORE TenantContext
     * was set; here we ADD @Transactional because the controller call site
     * runs AFTER TenantContextFilter has already set the context.
     */
    @Transactional
    public CreateResult create(UUID tenantId, UUID initiatorAccountId,
                               List<PlanItem> items, BillingCycle cycle,
                               String subdomain, String email) {
        if (items == null || items.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Select at least one module (with a seat count).");
        }
        // NORMALISE FIRST — every downstream identity check keys off planKey:
        // the advisory lock, the JSONB containment probe, `? = ANY(plan_keys)`,
        // and SubscriptionService's Razorpay-plan cache. ModulePlanService
        // resolves keys case-insensitively (trim + lowercase), so without
        // normalising here a request for "HR" validates fine against the "hr"
        // catalog row but matches NOTHING in any of those checks — sailing
        // past the duplicate guard and creating a second Razorpay
        // subscription for a module the customer already pays for. The
        // controller only validates @NotBlank/@Size, so this is the single
        // choke point where the canonical form must be established.
        items = items.stream()
                .map(i -> new PlanItem(
                        i.planKey() == null ? null : i.planKey().trim().toLowerCase(Locale.ROOT),
                        i.seats()))
                .toList();
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
        String planKey = it.planKey();   // already normalised above

        // PREVENT DUPLICATE SUBSCRIPTION for the same (tenant, plan_key).
        // Client-critical 2026-08-08: a second click on "Set Up Autopay" for
        // an already-active plan would create a SECOND Razorpay subscription
        // and DOUBLE-BILL the customer. Guard against it explicitly and
        // point them at the change-plan flow instead.
        //
        // TWO-LAYER PROTECTION:
        //   (1) pg_advisory_xact_lock keyed by (tenant_id, plan_key)
        //       serialises concurrent create() calls across Cloud Run
        //       instances — the second racer blocks until the first commits,
        //       then reads the freshly-inserted AWAITING_MANDATE row and
        //       409s. Autoreleased at transaction end (we're @Transactional).
        //   (2) Guard SQL counts BOTH platform.subscriptions AND
        //       platform.plan_change_requests. Ledger rows only appear after
        //       activate() (which fires from the webhook, minutes-to-hours
        //       later), so without the plan_change_requests check two clicks
        //       during the mandate-authorisation window both slip through
        //       and each creates a Razorpay subscription.
        long lockKey = (((long) tenantId.hashCode()) << 32)
                     | (planKey.hashCode() & 0xffffffffL);
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)", Object.class, lockKey);

        Integer existingLedger = jdbc.queryForObject("""
                SELECT count(*) FROM platform.subscriptions
                 WHERE tenant_id = ?
                   AND status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','PAUSED','GRACE')
                   AND razorpay_subscription_id IS NOT NULL
                   AND ? = ANY(plan_keys)
                """, Integer.class, tenantId, planKey);
        // What blocks a retry:
        //   * any row that still has a LIVE Razorpay subscription attached, no
        //     matter how old, OR
        //   * a young row that never got that far.
        //
        // The razorpay_subscription_id clause is the safety-critical half.
        // Releasing on elapsed time alone is an inference that the customer
        // did not pay — and we are not entitled to make it, because the
        // mandate may well be authorised with only the webhook lost. A purely
        // time-based guard let that customer click Set Up Autopay again and
        // mint a SECOND mandate against the same UPI for a module they are
        // already paying for. A row carrying an upstream subscription
        // therefore stops blocking only once something has explicitly
        // CANCELLED that subscription and moved the row to a terminal status
        // (see PlanChangeRecoveryService.expireAbandoned, which verifies with
        // Razorpay before cancelling anything). The expires_at half still
        // releases rows that never reached Razorpay at all — create() can
        // insert the row and then fail on the API call.
        Integer existingPending = jdbc.queryForObject("""
                SELECT count(*) FROM platform.plan_change_requests
                 WHERE tenant_id = ?
                   AND status = 'AWAITING_MANDATE'
                   AND (razorpay_subscription_id IS NOT NULL
                        OR expires_at IS NULL
                        OR expires_at > now())
                   AND plan_items::jsonb @> ?::jsonb
                """, Integer.class, tenantId,
                "[{\"planKey\":\"" + planKey + "\"}]");
        if (existingLedger != null && existingLedger > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This module is already on autopay for this workspace. "
                    + "Use 'Change Plan' on the /plan page to update seats, "
                    + "or cancel the existing autopay first.");
        }
        if (existingPending != null && existingPending > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "A payment for this module is already in progress. Finish it in the "
                    + "Razorpay tab, or use “I paid but it’s still locked” on the "
                    + "plan page if you have already paid.");
        }

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
     *
     * <p>@Transactional so the multi-row upsert into tenant_modules + the
     * final status flip commit together (or roll back together on error).
     * TenantContext is null on the webhook thread (Razorpay is anonymous),
     * so autoCommit stays true when leased — Spring's @Transactional still
     * forces autoCommit=false and manages commit/rollback itself.
     */
    @Transactional
    public boolean activate(UUID planChangeRequestId) {
        Row r = requireRow(planChangeRequestId);
        if ("ACTIVATED".equals(r.status)) {
            log.info("plan-change {} already ACTIVATED — webhook re-delivery, skipping.", planChangeRequestId);
            return false;
        }
        if (!"AWAITING_MANDATE".equals(r.status)) {
            log.warn("plan-change {} not in AWAITING_MANDATE (status={}), skipping activation.",
                    planChangeRequestId, r.status);
            return false;
        }

        String cycleUpper = "yearly".equalsIgnoreCase(r.billingCycle) ? "ANNUAL" : "MONTHLY";
        BillingCycle cycle = "ANNUAL".equals(cycleUpper) ? BillingCycle.ANNUAL : BillingCycle.MONTHLY;

        List<PlanItem> items = fromJson(r.planItemsJson);
        List<String> allPlanKeys = new java.util.ArrayList<>();
        List<String> allCatalogKeys = new java.util.ArrayList<>();
        int totalSeats = 0;
        // effective per-cycle amount (accounts for annual_discount_pct — must
        // match what SubscriptionService.createSubscription actually charged
        // Razorpay, else the ledger diverges from real revenue on every
        // ANNUAL activation by the discount factor. See verify finding
        // "amount_inr and unit_price_inr ignore annual_discount_pct").
        BigDecimal cycleAmount = BigDecimal.ZERO;
        BigDecimal effectiveMonthlyUnitLast = BigDecimal.ZERO;

        // Expand every plan's included_modules and upsert tenant_modules ACTIVE
        // rows with the requested seat count. ON CONFLICT keeps existing rows
        // (they were selected before) but bumps their seats to the new value.
        for (PlanItem it : items) {
            // LENIENT lookup — this subscription is already paid for. Using the
            // strict requireAvailable() here meant that flipping a catalog row
            // to LAUNCHING_SOON (or renaming it) after someone bought it made
            // activation throw 400 forever: the @Transactional rollback left
            // the row at AWAITING_MANDATE, markFailed was never reached, and
            // the admin's status endpoint showed an eternal spinner while
            // their money was gone.
            ModulePlanDto plan = planService.findLenient(it.planKey()).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Plan '" + it.planKey() + "' no longer exists in the catalog; "
                            + "cannot activate this purchase"));
            List<String> catalogKeys = planService.expandModules(List.of(plan));
            allPlanKeys.add(it.planKey());
            allCatalogKeys.addAll(catalogKeys);
            totalSeats = Math.max(totalSeats, it.seats());   // per-module seats; overall = max across bundle
            // Discount-aware per-seat rate. For MONTHLY this is priceInr()
            // rounded; for ANNUAL it is priceInr() * (1 - discount_pct/100)
            // rounded. Multiplied by 12 for ANNUAL to get the yearly charge.
            BigDecimal effectiveMonthlyUnit = planService.effectiveMonthlyUnit(plan, cycle);
            effectiveMonthlyUnitLast = effectiveMonthlyUnit;
            BigDecimal perPlanMonthly = effectiveMonthlyUnit
                    .multiply(BigDecimal.valueOf(it.seats()));
            BigDecimal perPlanCycle = cycle == BillingCycle.ANNUAL
                    ? perPlanMonthly.multiply(BigDecimal.valueOf(12))
                    : perPlanMonthly;
            cycleAmount = cycleAmount.add(perPlanCycle);
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

        // unit_price_inr = the per-seat MONTHLY rate we billed (already
        // discount-adjusted). One plan today so this is exact; when
        // multi-plan bundles ship this becomes an average.
        BigDecimal unitPrice = effectiveMonthlyUnitLast;

        // CRITICAL: insert a platform.subscriptions ledger row for this plan-change.
        // Historically only the SIGNUP path (MandateProvisioningService) wrote to
        // subscriptions, so post-signup add-a-module flows left the ledger empty
        // — which made the "duplicate subscription" guard silently fail (its
        // count(*) returned 0 for any module added via /plan). The guard broke
        // when a customer tried to add a second module. Fix: write the ledger row
        // HERE too, and use ON CONFLICT so a webhook re-delivery is idempotent
        // (the partial unique index ux_subscriptions_razorpay_subscription_id
        // guarantees the ON CONFLICT target exists for our non-null id).
        //
        // Also records amount_inr + unit_price_inr so revenue reporting per
        // subscription actually works (previously stuck at ₹0 for autopay).
        //
        // current_period_end is NOT NULL in the schema (V087, no default). We
        // don't have the exact Razorpay cycle boundary here without another
        // Razorpay fetch (subscription.activated payload isn't on this thread),
        // so we set it optimistically to now() + 1 month/year — the
        // subscription.charged webhook's onActive() will overwrite with the
        // real current_end from Razorpay within seconds. Without this, every
        // activation Postgres-500'd on a NOT NULL violation (verify caught).
        String periodEndInterval = cycle == BillingCycle.ANNUAL ? "1 year" : "1 month";
        jdbc.update("""
                INSERT INTO platform.subscriptions
                    (id, tenant_id, plan_keys, modules, seats, billing_cycle,
                     unit_price_inr, amount_inr, currency, status, plan_type,
                     razorpay_subscription_id, auto_renew,
                     current_period_start, current_period_end,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?,
                        ?, ?, 'INR', 'ACTIVE', 'PAID',
                        ?, TRUE,
                        now(), now() + interval '""" + periodEndInterval + """
                                                                          ',
                        now(), now())
                ON CONFLICT (razorpay_subscription_id)
                    WHERE razorpay_subscription_id IS NOT NULL
                    DO UPDATE SET
                        plan_keys          = EXCLUDED.plan_keys,
                        modules            = EXCLUDED.modules,
                        seats              = EXCLUDED.seats,
                        unit_price_inr     = EXCLUDED.unit_price_inr,
                        amount_inr         = EXCLUDED.amount_inr,
                        current_period_end = COALESCE(platform.subscriptions.current_period_end,
                                                      EXCLUDED.current_period_end),
                        status             = 'ACTIVE',
                        updated_at         = now()
                """,
                UUID.randomUUID(), r.tenantId,
                allPlanKeys.toArray(new String[0]),
                allCatalogKeys.toArray(new String[0]),
                totalSeats, cycleUpper,
                unitPrice, cycleAmount,
                r.razorpaySubscriptionId);

        // Guarded final flip: reject the write if the row is no longer
        // AWAITING_MANDATE (someone cancelled/failed it between our initial
        // read and this UPDATE). Without the guard a concurrent markCancelled
        // silently gets overwritten to ACTIVATED. Then throw so @Transactional
        // rolls back the whole activation (the racing cancellation wins).
        int flipRows = jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET status = 'ACTIVATED', activated_at = now(), updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, planChangeRequestId);
        if (flipRows == 0) {
            log.warn("plan-change {} raced with cancel/fail — rolling back activation.",
                    planChangeRequestId);
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "plan-change was cancelled or failed concurrently; activation aborted");
        }

        log.info("plan-change {} ACTIVATED on tenant {} — {} plan(s), {} seats, ₹{}/{}",
                planChangeRequestId, r.tenantId, items.size(), totalSeats,
                cycleAmount, cycle == BillingCycle.ANNUAL ? "yr" : "mo");
        return true;
    }

    // -- stranded-request recovery (lost-webhook self-heal) ------------------

    /**
     * Find plan-change requests stuck in AWAITING_MANDATE that already have a
     * Razorpay subscription id — i.e. the customer WAS sent to Razorpay's
     * checkout and we have something to ask Razorpay about.
     *
     * <p><b>Why this exists.</b> All three of our existing safety nets (the
     * access guard, the hourly reconciliation cron, and the webhook itself)
     * read from {@code platform.subscriptions}. On a FIRST purchase that row
     * does not exist yet — it is created by {@link #activate}, which only runs
     * when the webhook lands. So if that one webhook is lost, the customer's
     * money is gone, the module stays locked, and NOTHING in the system ever
     * recovers it. Every net sweeps straight past because their query returns
     * zero rows. {@link PlanChangeRecoveryService} closes that hole by asking
     * Razorpay directly about the rows this method returns.
     *
     * @param tenantId    restrict to one workspace, or {@code null} to sweep all
     * @param minAgeSecs  ignore rows younger than this so we don't race the
     *                    webhook that is probably already in flight
     */
    public List<Stranded> findStranded(UUID tenantId, int minAgeSecs, int limit) {
        // Deliberately NOT bounded by expires_at. An old row is not evidence
        // that nobody paid — it is often the exact opposite, a purchase whose
        // webhook was lost and which has been waiting the longest for someone
        // to notice. Excluding past-expiry rows here would blind the self-heal
        // to precisely the cases it exists for.
        //
        // Queue starvation (dead "created" rows accumulating at the head of an
        // oldest-first LIMIT and crowding out real work) is handled properly by
        // PlanChangeRecoveryService.expireAbandoned, which verifies each row
        // with Razorpay and transitions the genuinely-dead ones out of
        // AWAITING_MANDATE — so they stop matching this query at the status
        // predicate, which is the honest way for them to leave the queue.
        String sql = """
                SELECT id, tenant_id, razorpay_subscription_id
                  FROM platform.plan_change_requests
                 WHERE status = 'AWAITING_MANDATE'
                   AND razorpay_subscription_id IS NOT NULL
                   AND created_at < now() - make_interval(secs => ?)
                """
                + (tenantId == null ? "" : " AND tenant_id = ? ")
                + " ORDER BY created_at LIMIT ?";
        Object[] args = tenantId == null
                ? new Object[]{ minAgeSecs, limit }
                : new Object[]{ minAgeSecs, tenantId, limit };
        return jdbc.query(sql, (rs, n) -> new Stranded(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("tenant_id")),
                rs.getString("razorpay_subscription_id")), args);
    }

    /**
     * Plan-change requests past their {@code expires_at} that are still
     * AWAITING_MANDATE — abandoned checkouts. Mirrors
     * {@code PendingSignupService.findExpiredAwaiting} for the in-workspace
     * flow, which never had an equivalent. The partial index
     * {@code ix_plan_change_requests_expires_at WHERE status='AWAITING_MANDATE'}
     * was shipped for exactly this query and had no reader until now.
     */
    public List<Stranded> findExpiredAwaiting(int limit) {
        return jdbc.query("""
                SELECT id, tenant_id, razorpay_subscription_id
                  FROM platform.plan_change_requests
                 WHERE status = 'AWAITING_MANDATE'
                   AND expires_at IS NOT NULL
                   AND expires_at <= now()
                 ORDER BY expires_at
                 LIMIT ?
                """, (rs, n) -> new Stranded(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("tenant_id")),
                rs.getString("razorpay_subscription_id")), limit);
    }

    /**
     * Close out an abandoned checkout. Guarded on AWAITING_MANDATE so it can
     * never stomp a request that activated in the meantime.
     *
     * @return true if this call was the one that expired the row
     */
    @Transactional
    public boolean markExpired(UUID id) {
        return jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET status = 'EXPIRED',
                       failure_reason = COALESCE(failure_reason,
                                                 'mandate not authorised before expiry'),
                       updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, id) > 0;
    }

    /** A plan-change request awaiting a mandate confirmation we may never get. */
    public record Stranded(UUID id, UUID tenantId, String razorpaySubscriptionId) {}

    @Transactional
    public void markFailed(UUID id, String reason) {
        jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET status = 'FAILED', failure_reason = ?, updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, reason, id);
    }

    @Transactional
    public void markCancelled(UUID id) {
        jdbc.update("""
                UPDATE platform.plan_change_requests
                   SET status = 'CANCELLED', updated_at = now()
                 WHERE id = ? AND status = 'AWAITING_MANDATE'
                """, id);
    }

    // -- change existing subscription (Hotstar-style, reuses same mandate) ---

    /**
     * Change the seat count on an existing autopay subscription. Same UPI/card
     * mandate the admin already authorised — no re-authorisation needed as
     * long as the new amount stays under the mandate's max_amount ceiling
     * (Razorpay typically sets max at 1.5–2× the initial amount).
     *
     * <p>Timing:
     * <ul>
     *   <li>Razorpay charges the prorated difference on the current cycle
     *       immediately (schedule_change_at="now").</li>
     *   <li>Next renewal bills the full new amount.</li>
     * </ul>
     *
     * <p>Idempotency: if the current seat count already matches the requested
     * count, this is a no-op (no Razorpay call, no billing event).
     */
    @Transactional
    public ChangeResult changeSeatCount(UUID tenantId, String rawPlanKey, int newSeats) {
        if (newSeats < 1 || newSeats > 999) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Seat count must be between 1 and 999");
        }
        // Same canonicalisation as create() — the advisory lock and the
        // `? = ANY(plan_keys)` lookup below both key off this value.
        String planKey = rawPlanKey == null ? "" : rawPlanKey.trim().toLowerCase(Locale.ROOT);
        if (planKey.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "planKey is required");
        }

        // (1) DB-level serialisation. Two concurrent Confirm clicks (double-tap,
        //     two admin tabs) or two Cloud Run instances handling the same
        //     retry would both pass a plain SELECT and each fire a Razorpay
        //     updateSubscription — Razorpay treats each as a fresh proration
        //     event and can debit the UPI TWICE. Advisory lock serialises them
        //     across all instances; the second waiter blocks until the first
        //     commits and then sees the updated seats on its SELECT.
        long lockKey = (((long) tenantId.hashCode()) << 32)
                     | (planKey.hashCode() & 0xffffffffL);
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)", Object.class, lockKey);

        // (2) Load the row we're about to change UNDER the lock. FOR UPDATE
        //     doubles as belt-and-suspenders in case someone bypasses the
        //     advisory lock in the future.
        LockedSub sub = lockActiveSubscriptionForPlan(tenantId, planKey);
        if (sub == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "No active subscription found for this plan. Use Set Up Autopay first.");
        }
        if (sub.razorpaySubscriptionId == null || sub.razorpaySubscriptionId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Subscription has no Razorpay mandate yet — please wait for the initial mandate to complete.");
        }
        if (sub.seats == newSeats) {
            return new ChangeResult(sub.razorpaySubscriptionId, sub.seats, newSeats,
                    /*charged*/ false, "Seat count unchanged — no billing action.");
        }

        // (3) Status guard. Razorpay refuses (or silently no-ops) quantity
        //     updates on halted/paused/past_due mandates — proration needs a
        //     working mandate. Reject with a 409 that steers the admin to
        //     re-authorise instead of failing opaquely a month later.
        if (!("ACTIVE".equals(sub.status) || "TRIALING".equals(sub.status))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Autopay is currently " + sub.status.toLowerCase(Locale.ROOT)
                    + " — please update your payment method before changing seats. "
                    + "Try /plan again once your mandate is active.");
        }

        // (4) Frozen per-seat unit price from the LEDGER (what we billed at
        //     activation, and what Razorpay's razorpay_plan_id is pinned to
        //     — the two were computed from the same effectiveMonthlyUnit).
        //     Recomputing from live module_plans.price_inr would silently
        //     diverge from Razorpay's actual debit if pricing migrates while
        //     an active subscription exists.
        //
        //     BUT the ledger price is not always populated: the signup path
        //     (MandateProvisioningService) inserts unit_price_inr = 0 with a
        //     "filled in later from subscription.charged" comment, and nothing
        //     ever fills it in — onActive/onUpdated write only status and
        //     timestamps. Trusting a 0 here would write amount_inr = 0 on
        //     every seat change for a signup-originated subscription, zeroing
        //     out that customer's revenue in our books. Fall back to the
        //     catalog rate for that cycle, which is exactly what the signup
        //     path priced Razorpay with in the first place.
        BigDecimal unitMonthly = sub.unitPriceInr;
        if (unitMonthly == null || unitMonthly.signum() <= 0) {
            BillingCycle subCycle = "ANNUAL".equalsIgnoreCase(sub.billingCycle)
                    ? BillingCycle.ANNUAL : BillingCycle.MONTHLY;
            unitMonthly = planService.findLenient(planKey)
                    .map(p -> planService.effectiveMonthlyUnit(p, subCycle))
                    .orElse(BigDecimal.ZERO);
            log.warn("subscription {} has unit_price_inr={} — falling back to catalog rate ₹{}/seat/mo "
                     + "for the seat-change amount (signup-path rows are inserted with 0)",
                    sub.razorpaySubscriptionId, sub.unitPriceInr, unitMonthly);
        }
        BigDecimal newMonthly = unitMonthly.multiply(BigDecimal.valueOf(newSeats));
        BigDecimal newAmount  = "ANNUAL".equalsIgnoreCase(sub.billingCycle)
                ? newMonthly.multiply(BigDecimal.valueOf(12))
                : newMonthly;

        // (5) DB writes FIRST. If any of them fail, Razorpay is never called
        //     and no drift is possible.
        jdbc.update("""
                UPDATE platform.subscriptions
                   SET seats = ?, amount_inr = ?, updated_at = now()
                 WHERE tenant_id = ?
                   AND razorpay_subscription_id = ?
                """, newSeats, newAmount, tenantId, sub.razorpaySubscriptionId);

        // Upsert (not blind UPDATE) into tenant_modules — a blind UPDATE
        // silently no-ops when the row doesn't exist (bundles can gain catalog
        // keys post-signup that were never seeded), leaving the customer
        // billed for seats the module refuses to grant.
        //
        // LENIENT lookup: this is a live, already-mandated subscription, not a
        // purchase. requireAvailable() would 400 here the moment the plan was
        // retired or flipped to LAUNCHING_SOON, locking an existing paying
        // customer out of changing their own seat count.
        List<ModulePlanDto> plans = List.of(planService.findLenient(planKey).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Plan '" + planKey + "' no longer exists in the catalog")));
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
                    """, UUID.randomUUID(), tenantId, moduleKey, newSeats);
        }

        // (6) Razorpay LAST, so a clean failure rolls the DB back with it and
        //     no drift is possible. Two residual windows remain, and both are
        //     alarmed rather than silently swallowed:
        //
        //     (a) AMBIGUOUS failure — read timeout / connection reset / edge
        //         502 AFTER Razorpay already applied the quantity. The client
        //         collapses every error into BAD_GATEWAY, so we genuinely
        //         cannot tell "never applied" from "applied, reply lost". The
        //         transaction rolls back to the old seat count while Razorpay
        //         may bill the new one. Log SEAT_DRIFT_AMBIGUOUS before
        //         rethrowing — this is the likelier drift path and the
        //         commit-time hook below never fires for it.
        //     (b) Razorpay succeeded but our COMMIT then failed (network
        //         partition at commit). Caught by registerDriftAlarm.
        SubscriptionService.QuantityChange change;
        try {
            change = subscriptions.updateQuantity(sub.razorpaySubscriptionId, newSeats);
        } catch (RuntimeException e) {
            log.error("SEAT_DRIFT_AMBIGUOUS tenant={} sub={} plan={} attempted {} -> {} : "
                      + "Razorpay call failed with no applied/not-applied signal ({}). "
                      + "DB rolled back to {} seats; VERIFY THE QUANTITY IN THE RAZORPAY DASHBOARD.",
                    tenantId, sub.razorpaySubscriptionId, planKey, sub.seats, newSeats,
                    e.getMessage(), sub.seats);
            throw e;
        }
        registerDriftAlarm(tenantId, sub.razorpaySubscriptionId, sub.seats, newSeats);

        int diff = newSeats - sub.seats;
        log.info("plan-change SEAT UPDATE tenant={} plan={} seats {} -> {} (diff {}, proratedNow={})",
                tenantId, planKey, sub.seats, newSeats, diff, change.proratedNow());

        // Tell them what will actually happen. During the free trial nothing
        // is charged today whichever way the count moves, and promising a
        // "prorated charge" there would be simply untrue.
        String message;
        if (!change.proratedNow()) {
            message = diff > 0
                ? "Updated to " + newSeats + " seats. You're still in your free trial, so nothing is charged "
                  + "now — your first payment will be for " + newSeats + " seats."
                : "Updated to " + newSeats + " seats. You're still in your free trial — your first payment "
                  + "will be for " + newSeats + " seats.";
        } else {
            message = diff > 0
                ? "Razorpay will charge the prorated difference for " + diff + " more seat(s) on your existing mandate."
                : "Seats reduced — the credit will be applied at your next renewal.";
        }
        return new ChangeResult(sub.razorpaySubscriptionId, sub.seats, newSeats,
                /*charged*/ change.proratedNow(), message);
    }

    /**
     * If the transaction commits: nothing. If it rolls back AFTER Razorpay
     * confirmed the change (commit-time failure), log SEAT_DRIFT so ops can
     * reconcile by hand.
     *
     * <p>Compensating auto-revert is not attempted: afterCompletion runs
     * outside any transaction with the connection already released, so a
     * Razorpay call here has nowhere to record its own outcome.
     *
     * <p><b>This log line is the ONLY detection mechanism for seat drift.</b>
     * Nothing else notices: {@code RazorpayClient.SubscriptionView} never
     * parses {@code quantity}, and both {@code SubscriptionReconciliationJob}
     * and {@code applyRazorpayStatus} reconcile status only — never seats. So
     * there is no background sweep that will find and repair this. Until
     * quantity is added to the reconciler, treat SEAT_DRIFT /
     * SEAT_DRIFT_AMBIGUOUS as a paging-worthy log-based alert in Cloud
     * Logging rather than something the system self-corrects.
     */
    private void registerDriftAlarm(UUID tenantId, String subId, int oldSeats, int newSeats) {
        if (!org.springframework.transaction.support.TransactionSynchronizationManager
                .isSynchronizationActive()) {
            return;
        }
        org.springframework.transaction.support.TransactionSynchronizationManager
                .registerSynchronization(new org.springframework.transaction.support.TransactionSynchronization() {
                    @Override public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) {
                            log.error("SEAT_DRIFT tenant={} sub={} : Razorpay updated to {} but DB commit failed (old={}) — MANUAL RECONCILE REQUIRED",
                                    tenantId, subId, newSeats, oldSeats);
                        }
                    }
                });
    }

    /** Row-locking variant of findActiveSubscriptionForPlan. Uses FOR UPDATE
     *  so concurrent changeSeatCount calls serialise, and pulls only the fields
     *  needed for the seat-change decision. Requires an outer @Transactional. */
    private LockedSub lockActiveSubscriptionForPlan(UUID tenantId, String planKey) {
        try {
            return jdbc.queryForObject("""
                    SELECT seats, billing_cycle, unit_price_inr, status,
                           razorpay_subscription_id
                      FROM platform.subscriptions
                     WHERE tenant_id = ?
                       AND status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','PAUSED','GRACE')
                       AND razorpay_subscription_id IS NOT NULL
                       AND ? = ANY(plan_keys)
                     ORDER BY created_at DESC
                     LIMIT 1
                     FOR UPDATE
                    """, (rs, n) -> new LockedSub(
                            rs.getInt("seats"),
                            rs.getString("billing_cycle"),
                            rs.getBigDecimal("unit_price_inr"),
                            rs.getString("status"),
                            rs.getString("razorpay_subscription_id")),
                    tenantId, planKey);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private record LockedSub(int seats, String billingCycle, BigDecimal unitPriceInr,
                             String status, String razorpaySubscriptionId) {}

    /** List active subscriptions for a tenant — used by /plan to show current state. */
    public List<ActiveSub> listActiveSubscriptions(UUID tenantId) {
        List<ActiveSub> out = new java.util.ArrayList<>();
        jdbc.query("""
                SELECT plan_keys, seats, billing_cycle, unit_price_inr, amount_inr,
                       status, current_period_end, next_charge_at, halted_at, grace_until,
                       razorpay_subscription_id
                  FROM platform.subscriptions
                 WHERE tenant_id = ?
                   AND status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','PAUSED','GRACE')
                   AND razorpay_subscription_id IS NOT NULL
                 ORDER BY created_at DESC
                """, rs -> {
            java.sql.Array arr = rs.getArray("plan_keys");
            List<String> keys = arr != null ? List.of((String[]) arr.getArray()) : List.of();
            String primaryPlanKey = keys.isEmpty() ? null : keys.get(0);
            out.add(new ActiveSub(
                    primaryPlanKey,
                    keys,
                    rs.getInt("seats"),
                    rs.getString("billing_cycle"),
                    rs.getBigDecimal("unit_price_inr"),
                    rs.getBigDecimal("amount_inr"),
                    rs.getString("status"),
                    ts(rs, "current_period_end"),
                    ts(rs, "next_charge_at"),
                    ts(rs, "halted_at"),
                    ts(rs, "grace_until"),
                    rs.getString("razorpay_subscription_id")));
        }, tenantId);
        return out;
    }

    /**
     * Plans this tenant demonstrably OWNS (every module the plan unlocks is
     * ACTIVE in {@code platform.tenant_modules}) but which have no billing row
     * in {@code platform.subscriptions}.
     *
     * <p><b>Why this exists.</b> {@code /plan} used to answer "what do you
     * already have?" purely from the subscriptions ledger, while {@code /modules}
     * answers it from {@code tenant_modules}. Those two can disagree, and in
     * production they did: a tenant that activated through the in-workspace
     * flow before {@code activate()} started writing the ledger has ACTIVE
     * modules and no subscription row. The result was a workspace with HR
     * visibly unlocked on one page and offered for sale from scratch on the
     * other, with no way to see or manage what it already had.
     *
     * <p>Reading the modules table closes that gap for every affected tenant
     * at once, including ones nobody has noticed yet — which a one-off data
     * backfill could not do, since we cannot go resetting live customers'
     * rows.
     *
     * <p>Deliberately NOT used by the duplicate-purchase guard. Owning modules
     * without a billing row is exactly the state where the customer SHOULD be
     * able to buy: their mandate was cancelled or never charged. Blocking them
     * would lock them out of ever paying. Only a real billing row means money
     * is already flowing and a second purchase would double-charge.
     *
     * @return one entry per owned-but-unbilled plan, seats taken from the
     *         highest seat count across the plan's modules
     */
    public List<OwnedUnbilled> findOwnedButUnbilled(UUID tenantId) {
        Map<String, Integer> activeModules = new java.util.HashMap<>();
        jdbc.query("""
                SELECT module_key, COALESCE(seats, 0) AS seats
                  FROM platform.tenant_modules
                 WHERE tenant_id = ? AND status = 'ACTIVE'
                """, rs -> {
            activeModules.put(rs.getString("module_key"), rs.getInt("seats"));
        }, tenantId);
        if (activeModules.isEmpty()) return List.of();

        // Plans already carrying a billing row — those render from the ledger.
        Set<String> billed = new java.util.HashSet<>();
        for (ActiveSub s : listActiveSubscriptions(tenantId)) billed.addAll(s.planKeys());

        List<OwnedUnbilled> out = new java.util.ArrayList<>();
        for (ModulePlanDto plan : planService.listPlans()) {
            // AVAILABLE only. The catalog also carries RETIRED plans (crm,
            // sales, pos, accounting-inventory — superseded by bundles) and
            // LAUNCHING_SOON ones, and legacy tenants have their modules
            // switched on. Surfacing those would put a card on the page for
            // every one of them, each offering a "set up autopay" button that
            // create() rejects with 400 because you cannot buy a plan that is
            // not on sale. One live tenant matched ten such plans.
            if (!"AVAILABLE".equalsIgnoreCase(plan.status())) continue;
            List<String> needed = plan.includedModules();
            // A plan that unlocks nothing would "match" every tenant vacuously.
            if (needed == null || needed.isEmpty()) continue;
            if (billed.contains(plan.key())) continue;
            // Every module the plan grants must be live — partial overlap is
            // not ownership.
            if (!activeModules.keySet().containsAll(needed)) continue;
            int seats = needed.stream().mapToInt(m -> activeModules.getOrDefault(m, 0)).max().orElse(0);
            out.add(new OwnedUnbilled(plan.key(), plan.displayName(), needed, seats));
        }
        return out;
    }

    /** A plan whose modules are live but which nothing is billing for. */
    public record OwnedUnbilled(String planKey, String displayName,
                                List<String> modules, int seats) {}

    private ActiveSub findActiveSubscriptionForPlan(UUID tenantId, String planKey) {
        try {
            return jdbc.queryForObject("""
                    SELECT plan_keys, seats, billing_cycle, unit_price_inr, amount_inr,
                           status, current_period_end, next_charge_at, halted_at, grace_until,
                           razorpay_subscription_id
                      FROM platform.subscriptions
                     WHERE tenant_id = ?
                       AND status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','PAUSED','GRACE')
                       AND razorpay_subscription_id IS NOT NULL
                       AND ? = ANY(plan_keys)
                     ORDER BY created_at DESC
                     LIMIT 1
                    """, (rs, n) -> {
                java.sql.Array arr = rs.getArray("plan_keys");
                List<String> keys = arr != null ? List.of((String[]) arr.getArray()) : List.of();
                return new ActiveSub(
                        planKey, keys,
                        rs.getInt("seats"),
                        rs.getString("billing_cycle"),
                        rs.getBigDecimal("unit_price_inr"),
                        rs.getBigDecimal("amount_inr"),
                        rs.getString("status"),
                        ts(rs, "current_period_end"),
                        ts(rs, "next_charge_at"),
                        ts(rs, "halted_at"),
                        ts(rs, "grace_until"),
                        rs.getString("razorpay_subscription_id"));
            }, tenantId, planKey);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private static java.time.Instant ts(java.sql.ResultSet rs, String col) throws SQLException {
        java.sql.Timestamp t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
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

    /** Snapshot of an active platform.subscriptions row for a tenant. Read by
     *  /v1/workspace/plan/current so the frontend can show current state
     *  ("HR — 10 seats — ₹390/mo — next charge Sep 8") + provide change/cancel
     *  actions. */
    public record ActiveSub(
            String primaryPlanKey,
            List<String> planKeys,
            int seats,
            String billingCycle,
            java.math.BigDecimal unitPriceInr,
            java.math.BigDecimal amountInr,
            String status,
            java.time.Instant currentPeriodEnd,
            java.time.Instant nextChargeAt,
            java.time.Instant haltedAt,
            java.time.Instant graceUntil,
            String razorpaySubscriptionId) {}

    /** Result of a change-seat operation. {@code charged=true} means Razorpay
     *  will attempt a prorated charge on the existing mandate (fires
     *  {@code subscription.charged} webhook asynchronously). */
    public record ChangeResult(
            String razorpaySubscriptionId,
            int previousSeats,
            int newSeats,
            boolean charged,
            String message) {}

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
