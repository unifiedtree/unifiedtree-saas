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
    private final RazorpayProperties props;
    private final JdbcTemplate jdbc;

    public WorkspacePlanController(PlanChangeService plans,
                                   SubscriptionService subscriptions,
                                   RazorpayProperties props,
                                   JdbcTemplate jdbc) {
        this.plans = plans;
        this.subscriptions = subscriptions;
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

    @PostMapping("/setup-autopay/cancel")
    public ResponseEntity<CancelResponse> cancel(
            @RequestBody CancelRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        if (req == null || req.id() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "id is required");
        }
        JwtClaims claims = extractClaims(jwt);
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

    private record JwtClaims(UUID tenantId, UUID accountId, List<String> roles) {}
    private record TenantMeta(String subdomain, String email) {}
}
