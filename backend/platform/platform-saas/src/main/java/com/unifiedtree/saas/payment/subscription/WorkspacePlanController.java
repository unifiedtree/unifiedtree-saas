package com.unifiedtree.saas.payment.subscription;

import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.plans.BillingCycle;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Authenticated (workspace JWT) endpoints for the in-workspace autopay
 * setup — the counterpart to {@link com.unifiedtree.saas.signup.SubscriptionSignupController}
 * for existing tenants.
 *
 * <p>Auth model: the JWT carries tenant + account claims. Only workspace
 * admins may open a plan-change; we enforce that by role at request time
 * (SUPER_ADMIN or COMPANY_ADMIN). Non-admins get 403.
 *
 * <p>Endpoint contract:
 * <pre>
 *   POST /v1/workspace/plan/setup-autopay
 *     body: { items: [{planKey, seats}, ...], billingCycle }
 *     resp: { planChangeRequestId, razorpaySubscriptionId, checkoutShortUrl, keyId }
 *
 *   GET  /v1/workspace/plan/setup-autopay/status?id=&lt;uuid&gt;
 *     resp: { status, activatedModules, failureReason }
 *
 *   POST /v1/workspace/plan/setup-autopay/cancel
 *     body: { id }
 *     resp: { status }
 * </pre>
 */
@RestController
@RequestMapping("/v1/workspace/plan")
public class WorkspacePlanController {

    private static final Logger log = LoggerFactory.getLogger(WorkspacePlanController.class);

    private final PlanChangeService plans;
    private final SubscriptionService subscriptions;
    private final PlanChangeRecoveryService recovery;
    private final SubscriptionStateReconciler reconciler;
    private final RazorpayProperties props;
    private final JdbcTemplate jdbc;

    public WorkspacePlanController(PlanChangeService plans,
                                   SubscriptionService subscriptions,
                                   PlanChangeRecoveryService recovery,
                                   SubscriptionStateReconciler reconciler,
                                   RazorpayProperties props,
                                   JdbcTemplate jdbc) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.recovery = recovery;
        this.reconciler = reconciler;
        this.props = props;
        this.jdbc = jdbc;
    }

    // -- setup-autopay --------------------------------------------------------

    @PostMapping("/setup-autopay")
    public ResponseEntity<SetupAutopayResponse> setupAutopay(
            @Valid @RequestBody SetupAutopayRequest req,
            @AuthenticationPrincipal Jwt jwt) {

        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment gateway is not configured");
        }
        JwtClaims claims = extractClaims(jwt);
        requireAdmin(claims);

        BillingCycle cycle = BillingCycle.from(req.billingCycle());
        List<PlanChangeService.PlanItem> items = req.items().stream()
                .map(i -> new PlanChangeService.PlanItem(i.planKey(), i.seats()))
                .toList();

        // Resolve subdomain + email for Razorpay notes (audit trail + support).
        TenantMeta meta = loadTenantMeta(claims.tenantId());

        PlanChangeService.CreateResult r = plans.create(
                claims.tenantId(), claims.accountId(),
                items, cycle,
                meta.subdomain, meta.email);

        log.info("workspace plan-change opened tenant={} account={} pending={} rzpSub={}",
                claims.tenantId(), claims.accountId(),
                r.planChangeRequestId(), r.razorpaySubscriptionId());

        return ResponseEntity.ok(new SetupAutopayResponse(
                r.planChangeRequestId(),
                r.razorpaySubscriptionId(),
                r.checkoutShortUrl(),
                r.keyId()));
    }

    @GetMapping("/setup-autopay/status")
    public ResponseEntity<StatusResponse> status(
            @RequestParam("id") UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        JwtClaims claims = extractClaims(jwt);
        // Admin-only like every other endpoint here. Only an admin can start a
        // setup, so only an admin has any business reading its progress.
        requireAdmin(claims);
        PlanChangeService.PlanChangeRequest req = plans.findById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown request"));
        // Tenant isolation — must belong to the caller's tenant.
        if (!req.tenantId().equals(claims.tenantId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not your workspace's request");
        }
        List<String> activated = "ACTIVATED".equals(req.status())
                ? req.items().stream().map(PlanChangeService.PlanItem::planKey).toList()
                : List.of();
        return ResponseEntity.ok(new StatusResponse(
                req.status(), activated,
                humaniseFailureReason(req.status(), req.failureReason())));
    }

    // -- current + change (Hotstar-style) --------------------------------------

    /**
     * List the tenant's currently ACTIVE (or in-flight) subscriptions. Read
     * by the /plan page so it can render "HR — 10 seats — ₹390/mo — next
     * charge Sep 8" and show Change / Cancel actions instead of the
     * first-time "Set Up Autopay" form.
     */
    @GetMapping("/current")
    public ResponseEntity<CurrentSubscriptionsResponse> current(@AuthenticationPrincipal Jwt jwt) {
        JwtClaims claims = extractClaims(jwt);
        // Admin-only, for two reasons. The response carries workspace billing
        // detail (razorpaySubscriptionId, unit price, amount, seats, cycle
        // dates) that an ordinary employee has no business reading; and since
        // the self-heal below was added this GET also mutates — it can call
        // Razorpay and activate modules. Security is `anyRequest().authenticated()`
        // with no role gate on /v1/workspace/plan/**, so without this check any
        // employee JWT could both read the billing data and drive the
        // activation path at will. Plan.tsx already refuses to render for
        // non-admins, so no legitimate caller is affected.
        requireAdmin(claims);

        // SELF-HEAL before reading. If the admin paid for a module and the
        // subscription.activated webhook never reached us, the purchase is
        // stranded in AWAITING_MANDATE: money debited, module still locked,
        // and none of the ledger-based reconcilers can see it because no
        // platform.subscriptions row exists yet. Asking Razorpay here is what
        // makes the frontend's "refresh this page" advice actually true.
        // Costs one indexed query (zero rows in the healthy case) and only
        // reaches Razorpay when something is genuinely stuck — see
        // PlanChangeRecoveryService. Never fail the page load over it: a
        // Razorpay outage must not stop the admin from seeing their plan.
        try {
            int healed = recovery.recoverForTenant(claims.tenantId());
            if (healed > 0) {
                log.warn("workspace plan/current self-healed {} stranded purchase(s) for tenant={}",
                        healed, claims.tenantId());
            }
        } catch (RuntimeException e) {
            log.warn("plan/current self-heal failed for tenant={}: {}", claims.tenantId(), e.getMessage());
        }

        List<PlanChangeService.ActiveSub> subs = plans.listActiveSubscriptions(claims.tenantId());
        List<ActiveSubDto> dtos = new java.util.ArrayList<>(subs.stream().map(s -> new ActiveSubDto(
                s.primaryPlanKey(),
                s.planKeys(),
                s.seats(),
                s.billingCycle(),
                s.unitPriceInr(),
                s.amountInr(),
                s.status(),
                s.currentPeriodEnd(),
                s.nextChargeAt(),
                s.haltedAt(),
                s.graceUntil(),
                s.razorpaySubscriptionId(),
                /*billed=*/ true,
                // Only bill-and-charge subscriptions carry auto-renewal;
                // anything in a terminal Razorpay state stops renewing at
                // grace_until.
                /*autoRenew=*/ !("CANCELLED".equals(s.status())
                                 || "COMPLETED".equals(s.status())
                                 || "EXPIRED".equals(s.status()))
        )).toList());

        // Plans the workspace demonstrably owns (modules ACTIVE) but which
        // nothing is billing for. Without these, a tenant whose modules were
        // activated before activate() started writing the ledger — or whose
        // mandate was later cancelled — sees an empty "current plan" and is
        // invited to buy from scratch something /modules already shows as
        // unlocked. They render as owned-but-unbilled so the admin can see
        // the real state and start autopay, rather than silently duplicating.
        for (PlanChangeService.OwnedUnbilled o : plans.findOwnedButUnbilled(claims.tenantId())) {
            dtos.add(new ActiveSubDto(
                    o.planKey(), List.of(o.planKey()), o.seats(),
                    null, null, null,
                    "NO_AUTOPAY",
                    null, null, null, null, null,
                    /*billed=*/ false,
                    /*autoRenew=*/ false));
        }
        return ResponseEntity.ok(new CurrentSubscriptionsResponse(dtos));
    }

    /**
     * "I paid but my module is still locked" — the admin-triggered escape
     * hatch. Asks Razorpay directly about every stranded purchase on this
     * workspace and activates the ones it confirms were paid.
     *
     * <p>The same recovery runs automatically on {@code GET /current} and on a
     * 10-minute cron, so this endpoint is a reassurance affordance more than a
     * necessity — but when someone's money has left their bank and the screen
     * still says "locked", giving them a button that visibly does something is
     * worth more than telling them to wait. Never charges anything: it only
     * reads Razorpay's view and grants access the customer already paid for.
     */
    @PostMapping("/recover")
    public ResponseEntity<RecoverResponse> recover(@AuthenticationPrincipal Jwt jwt) {
        JwtClaims claims = extractClaims(jwt);
        requireAdmin(claims);
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment gateway is not configured");
        }
        int activated = recovery.recoverForTenant(claims.tenantId());
        log.info("workspace plan/recover tenant={} account={} activated={}",
                claims.tenantId(), claims.accountId(), activated);
        return ResponseEntity.ok(new RecoverResponse(
                activated,
                activated > 0
                    ? "Found your payment — your module is now unlocked."
                    : "No pending payment found. If money left your account in the last few "
                      + "minutes, wait a moment and try again; Razorpay can take a little "
                      + "while to confirm."));
    }

    /**
     * Change the seat count on an existing subscription. Same UPI mandate the
     * admin already authorised — Razorpay charges the prorated difference on
     * the current cycle, next renewal bills the new full amount.
     */
    @PostMapping("/change-seats")
    public ResponseEntity<ChangeSeatsResponse> changeSeats(
            @Valid @RequestBody ChangeSeatsRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment gateway is not configured");
        }
        JwtClaims claims = extractClaims(jwt);
        requireAdmin(claims);
        PlanChangeService.ChangeResult r = plans.changeSeatCount(
                claims.tenantId(), claims.accountId(), req.planKey(), req.newSeats());
        log.info("workspace change-seats tenant={} account={} plan={} {} -> {} (charged={}, reauth={})",
                claims.tenantId(), claims.accountId(), req.planKey(),
                r.previousSeats(), r.newSeats(), r.charged(), r.checkoutShortUrl() != null);
        return ResponseEntity.ok(new ChangeSeatsResponse(
                r.previousSeats(), r.newSeats(), r.charged(), r.message(),
                r.checkoutShortUrl(), r.planChangeRequestId(), r.keyId()));
    }

    @PostMapping("/setup-autopay/cancel")
    public ResponseEntity<CancelResponse> cancel(
            @RequestBody CancelRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        if (req == null || req.id() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "id is required");
        }
        JwtClaims claims = extractClaims(jwt);
        // Admin-only. This cancels a real Razorpay mandate — without the check
        // any authenticated employee who learned a pending request id could
        // kill their admin's in-flight payment mid-authorisation.
        requireAdmin(claims);
        Optional<PlanChangeService.PlanChangeRequest> maybe = plans.findById(req.id());
        if (maybe.isEmpty()) {
            return ResponseEntity.ok(new CancelResponse("ALREADY_GONE"));
        }
        PlanChangeService.PlanChangeRequest row = maybe.get();
        if (!row.tenantId().equals(claims.tenantId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not your workspace's request");
        }
        if (!"AWAITING_MANDATE".equals(row.status())) {
            return ResponseEntity.ok(new CancelResponse("NOOP_" + row.status()));
        }
        // Best-effort Razorpay cancel — logs + swallows inside cancelPreAuth so
        // a Razorpay-side hiccup doesn't leave our row stuck.
        subscriptions.cancelPreAuth(row.razorpaySubscriptionId());
        plans.markCancelled(row.id());
        log.info("workspace plan-change cancelled tenant={} pending={}", claims.tenantId(), row.id());
        return ResponseEntity.ok(new CancelResponse("CANCELLED"));
    }

    /**
     * Cancel a LIVE (already-activated) subscription. Different endpoint from
     * {@code /setup-autopay/cancel} above, which is only for in-flight
     * (AWAITING_MANDATE) authorisations. Semantics = Netflix-style: access
     * continues until the paid period ends, then modules revoke. See
     * {@link SubscriptionStateReconciler#onCancelled}.
     *
     * <p>Body: {@code { razorpaySubscriptionId }}. Response includes the
     * computed {@code graceUntil} the SPA shows on the confirmation banner.
     */
    @PostMapping("/cancel")
    public ResponseEntity<LiveCancelResponse> cancelLive(
            @RequestBody LiveCancelRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        if (req == null || req.razorpaySubscriptionId() == null
                || req.razorpaySubscriptionId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "razorpaySubscriptionId is required");
        }
        JwtClaims claims = extractClaims(jwt);
        requireAdmin(claims);

        // Verify the subscription belongs to the caller's workspace BEFORE any
        // Razorpay call — an admin from tenant A must not be able to cancel
        // tenant B's subscription just by guessing a sub_XXX id.
        java.util.Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT tenant_id, status, current_period_end, trial_ends_at,
                           plan_keys, seats
                      FROM platform.subscriptions
                     WHERE razorpay_subscription_id = ? LIMIT 1
                    """, req.razorpaySubscriptionId());
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "No subscription found for that id");
        }
        java.util.UUID subTenantId = (java.util.UUID) row.get("tenant_id");
        if (!claims.tenantId().equals(subTenantId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Not your workspace's subscription");
        }
        String status = (String) row.get("status");
        if (status != null && ("CANCELLED".equals(status) || "COMPLETED".equals(status)
                || "EXPIRED".equals(status))) {
            // Idempotent — the SPA can retry safely. Return the current
            // grace_until so the banner shows the right date.
            java.sql.Timestamp graceTs = jdbc.query(
                    "SELECT grace_until FROM platform.subscriptions WHERE razorpay_subscription_id = ? LIMIT 1",
                    rs -> rs.next() ? rs.getTimestamp("grace_until") : null,
                    req.razorpaySubscriptionId());
            return ResponseEntity.ok(new LiveCancelResponse(true, false,
                    graceTs == null ? null : graceTs.toInstant()));
        }

        // Cancel at Razorpay first (network side) — cancelAtCycleEnd=true so
        // any already-issued charges complete but no new debit happens. If
        // Razorpay says "already cancelled" swallow it and proceed to the
        // ledger update so we don't leave the two out of sync.
        try {
            subscriptions.cancel(req.razorpaySubscriptionId(), true);
        } catch (RuntimeException rzp) {
            log.warn("Razorpay cancel for {} failed ({}) — continuing to update ledger",
                    req.razorpaySubscriptionId(), rzp.getMessage());
        }

        // Update our ledger immediately (do not wait for webhook — user tapped
        // the button and expects visible confirmation). This also stamps
        // grace_until = trial_ends_at OR current_period_end.
        reconciler.onCancelled(req.razorpaySubscriptionId());

        // Read back the fresh grace_until + trial flag for the response body.
        java.util.Map<String, Object> after = jdbc.queryForMap("""
                SELECT grace_until, trial_ends_at FROM platform.subscriptions
                 WHERE razorpay_subscription_id = ? LIMIT 1
                """, req.razorpaySubscriptionId());
        java.sql.Timestamp graceTs = (java.sql.Timestamp) after.get("grace_until");
        java.sql.Timestamp trialTs = (java.sql.Timestamp) after.get("trial_ends_at");
        boolean wasInTrial = trialTs != null && trialTs.toInstant().isAfter(java.time.Instant.now());

        log.info("workspace subscription cancelled tenant={} sub={} graceUntil={} wasInTrial={}",
                claims.tenantId(), req.razorpaySubscriptionId(), graceTs, wasInTrial);

        return ResponseEntity.ok(new LiveCancelResponse(false, wasInTrial,
                graceTs == null ? null : graceTs.toInstant()));
    }

    // -- helpers --------------------------------------------------------------

    private void requireAdmin(JwtClaims claims) {
        // STRICT admin-only for billing / plan changes. HR_MANAGER is
        // intentionally EXCLUDED — an HR manager can approve leaves and
        // edit employees, but must not be able to authorise a Razorpay
        // mandate that will charge the workspace's account. Only the
        // workspace owner + platform-declared admin roles can do that.
        // (Client clarification, 2026-08-07.)
        boolean isAdmin = claims.roles().stream()
                .anyMatch(r -> "SUPER_ADMIN".equals(r) || "OWNER".equals(r)
                        || "COMPANY_ADMIN".equals(r));
        if (!isAdmin) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Only workspace admins can manage the plan");
        }
    }

    private JwtClaims extractClaims(Jwt jwt) {
        if (jwt == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing JWT");
        }
        UUID tenantId  = uuidClaim(jwt, "tenant_id", "tenantId");
        if (tenantId == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "JWT missing tenant_id");
        }
        // Workspace JWTs (issued by hrms-auth's JwtTokenProvider) carry
        // `sub` = auth_user_id, `tenant_id`, `email`, `roles` — but NOT
        // account_id. Resolve the account id by looking up
        // platform.account_workspaces(tenant_id, auth_user_id); fall back to
        // the tenant's owner_account_id if no membership row (defensive —
        // any authenticated user on this workspace MUST have a row).
        UUID userId = uuidClaim(jwt, "sub");
        UUID accountId = resolveAccountId(tenantId, userId);
        if (accountId == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Your account isn't linked to this workspace — please sign out and back in.");
        }
        List<String> roles = rolesClaim(jwt);
        return new JwtClaims(tenantId, accountId, roles);
    }

    /**
     * Two-step lookup for the initiating account id:
     *   1. platform.account_workspaces by (tenant_id, auth_user_id) —
     *      the "membership" row that maps a workspace user to their
     *      platform account. Present for every ACTIVE workspace user.
     *   2. Fallback: platform.tenants.owner_account_id — used only if
     *      the membership row is missing (data drift / manually-inserted
     *      test tenant). Not the primary path.
     */
    private UUID resolveAccountId(UUID tenantId, UUID userId) {
        if (userId != null) {
            try {
                String s = jdbc.queryForObject("""
                        SELECT account_id::text
                          FROM platform.account_workspaces
                         WHERE tenant_id = ? AND auth_user_id = ? AND status = 'ACTIVE'
                         LIMIT 1
                        """, String.class, tenantId, userId);
                if (s != null) return UUID.fromString(s);
            } catch (EmptyResultDataAccessException ignored) { /* fall through */ }
        }
        try {
            String s = jdbc.queryForObject("""
                    SELECT owner_account_id::text
                      FROM platform.tenants
                     WHERE id = ?
                    """, String.class, tenantId);
            return s == null ? null : UUID.fromString(s);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private static UUID uuidClaim(Jwt jwt, String... names) {
        for (String n : names) {
            Object v = jwt.getClaim(n);
            if (v != null) {
                try { return UUID.fromString(v.toString()); } catch (Exception ignored) { }
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static List<String> rolesClaim(Jwt jwt) {
        Object v = jwt.getClaim("roles");
        if (v instanceof List<?> l) return (List<String>) l;
        if (v instanceof String s && !s.isBlank()) return List.of(s.split(","));
        return List.of();
    }

    private TenantMeta loadTenantMeta(UUID tenantId) {
        try {
            return jdbc.queryForObject("""
                    SELECT subdomain, contact_email
                      FROM platform.tenants
                     WHERE id = ?
                    """, (rs, n) -> new TenantMeta(
                    rs.getString("subdomain"),
                    rs.getString("contact_email")), tenantId);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Tenant not found");
        }
    }

    /** Same shape SubscriptionSignupController uses — copy to keep the frontend
     *  wording consistent between the two entry points. */
    static String humaniseFailureReason(String status, String rawReason) {
        if (!"FAILED".equals(status)) return null;
        if (rawReason == null || rawReason.isBlank()) {
            return "We couldn't activate autopay. Please try again in a few minutes or contact support@unifiedtree.com.";
        }
        String lower = rawReason.toLowerCase(Locale.ROOT);
        if (lower.contains("row-level security") || lower.contains("violates row-level")) {
            return "Permissions error while activating modules. Please contact support@unifiedtree.com.";
        }
        if (lower.contains("check constraint") || lower.contains("violates check")) {
            return "Your selection doesn't fit our billing rules. Please cancel and try again.";
        }
        if (lower.contains("timeout") || lower.contains("timed out")) {
            return "The payment provider took too long to confirm your mandate. Please try again — you were not charged.";
        }
        return "We couldn't activate autopay. Please try again or contact support@unifiedtree.com.";
    }

    // -- DTOs -----------------------------------------------------------------

    public record SetupAutopayRequest(
            @NotEmpty(message = "Select at least one module") @Valid List<Item> items,
            @NotBlank @Size(max = 16) String billingCycle    // monthly | yearly
    ) {
        public record Item(
                @NotBlank @Size(max = 64) String planKey,
                @Min(1) int seats
        ) {}
    }

    public record SetupAutopayResponse(
            UUID planChangeRequestId,
            String razorpaySubscriptionId,
            String checkoutShortUrl,
            String keyId
    ) {}

    public record StatusResponse(
            String status,
            List<String> activatedModules,
            String failureReason
    ) {}

    public record CancelRequest(UUID id) {}
    public record CancelResponse(String status) {}

    /** Body for {@link #cancelLive}. */
    public record LiveCancelRequest(@NotBlank String razorpaySubscriptionId) {}

    /**
     * @param alreadyCancelled true if the subscription was already cancelled
     *        when we got the request (SPA retry, race with webhook, etc.).
     * @param wasInTrial       true if the cancellation happened while the trial
     *        was still active. The SPA uses this to swap the confirmation
     *        wording ("Your trial has ended..." vs "Your paid period runs
     *        until...").
     * @param graceUntil       moment access finally revokes. Access continues
     *        until this instant.
     */
    public record LiveCancelResponse(boolean alreadyCancelled,
                                     boolean wasInTrial,
                                     java.time.Instant graceUntil) {}

    public record ChangeSeatsRequest(
            @NotBlank @Size(max = 64) String planKey,
            @Min(1) int newSeats
    ) {}

    /**
     * @param checkoutShortUrl non-null when the existing mandate could not be
     *        modified (UPI is immutable once approved) and the customer must
     *        authorise a replacement. The client opens this and then polls
     *        {@code planChangeRequestId} through the normal
     *        {@code /setup-autopay/status} loop. The old mandate is cancelled
     *        automatically once the new one activates.
     */
    public record ChangeSeatsResponse(int previousSeats, int newSeats, boolean charged,
                                      String message, String checkoutShortUrl,
                                      UUID planChangeRequestId, String keyId) {}

    /** Result of a "I paid but it's still locked" recovery attempt. */
    public record RecoverResponse(int activated, String message) {}

    public record CurrentSubscriptionsResponse(List<ActiveSubDto> subscriptions) {}

    /**
     * One line in "Your current plan".
     *
     * @param billed {@code true} for a real {@code platform.subscriptions} row —
     *               money is flowing, seats can be changed on the existing
     *               mandate. {@code false} for a plan whose modules are ACTIVE
     *               with no billing behind them (mandate cancelled, or activated
     *               before the ledger write existed): status is
     *               {@code NO_AUTOPAY}, every billing field is null, and the UI
     *               must offer "set up autopay" rather than seat controls.
     */
    public record ActiveSubDto(
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
            String razorpaySubscriptionId,
            boolean billed,
            /** false once the sub is CANCELLED/COMPLETED/EXPIRED. SPA reads
             *  this to hide the seat +/- and Cancel button and show a
             *  "Resume subscription" link instead. */
            boolean autoRenew
    ) {}

    private record JwtClaims(UUID tenantId, UUID accountId, List<String> roles) {}
    private record TenantMeta(String subdomain, String email) {}
}
