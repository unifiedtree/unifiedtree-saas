package com.unifiedtree.saas.signup;

import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.payment.subscription.SubscriptionService;
import com.unifiedtree.saas.plans.BillingCycle;
import com.unifiedtree.saas.plans.ModulePlanService;
import com.unifiedtree.saas.service.SaasService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
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

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Unified public signup endpoint for both TRIAL and PAID autopay flows.
 *
 * <p>Sequence:
 * <ol>
 *   <li>Validate the payload and (for TRIAL only) refuse if the email is
 *       already claimed on {@code platform.accounts}.</li>
 *   <li>Compute {@code startAt = now + 7d} for TRIAL, else null (first
 *       charge immediate for PAID).</li>
 *   <li>Create a Razorpay Subscription; get back subscription id + short_url.</li>
 *   <li>Stash the intent in {@code platform.pending_signups} keyed by that
 *       subscription id. Password is hashed BEFORE the row is written so the
 *       webhook path never sees plaintext.</li>
 *   <li>Return {@code {pendingSignupId, razorpaySubscriptionId, checkoutShortUrl, mode}}
 *       to the browser, which redirects to the short_url for mandate approval.</li>
 * </ol>
 *
 * <p>No workspace is created here. The webhook creates it in
 * {@link MandateProvisioningService#provisionFromPending} once Razorpay
 * confirms mandate authentication.
 *
 * <p>A companion {@code GET /status} endpoint lets the frontend poll for
 * provisioning progress after the user returns from Razorpay.
 */
@RestController
@RequestMapping("/v1/public/subscription-signup")
public class SubscriptionSignupController {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionSignupController.class);
    private static final long TRIAL_DAYS = 7L;

    private final SubscriptionService subscriptions;
    private final PendingSignupService pending;
    private final PasswordService passwords;
    private final ModulePlanService planService;
    private final JdbcTemplate jdbc;
    private final RazorpayProperties props;
    private final PublicEndpointRateLimiter rateLimiter;

    public SubscriptionSignupController(SubscriptionService subscriptions,
                                        PendingSignupService pending,
                                        PasswordService passwords,
                                        ModulePlanService planService,
                                        JdbcTemplate jdbc,
                                        RazorpayProperties props,
                                        PublicEndpointRateLimiter rateLimiter) {
        this.subscriptions = subscriptions;
        this.pending = pending;
        this.passwords = passwords;
        this.planService = planService;
        this.jdbc = jdbc;
        this.props = props;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping
    public ResponseEntity<SubscriptionSignupResponse> signup(
            @Valid @RequestBody SubscriptionSignupRequest req,
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest http) {

        // ── Bundle B4: per-email + per-ip in-memory rate-limit ──────────────
        // 5 / 15min per email, 20 / 15min per ip. Sits BEFORE the payment
        // gateway config check so a flood cannot trigger a wave of Razorpay
        // API calls even when the gateway is up.
        rateLimiter.check("subscription-signup", clientIp(http), norm(req.adminEmail()));

        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment gateway is not configured");
        }

        // ------- 1. mode + JWT-based account resolution -----------------------
        Mode mode = Mode.from(req.mode());
        UUID signedInAccountId = jwt == null ? null : accountIdFromJwt(jwt);
        String email = norm(req.adminEmail());

        // ------- 2. duplicate-email guard (TRIAL only, when NOT signed in) ---
        // Bundle B4 D3 — TRIAL / anon path must NOT distinguish "email is
        // free" from "email is already claimed". A 409 on the existing-email
        // path was an enumeration oracle: attacker probes /subscription-signup
        // mode=TRIAL with any email, reads back "409 conflict" to confirm the
        // account exists (or "success shape" to confirm it doesn't). We now
        // silently short-circuit with the same 200-shaped response the fresh
        // signup path emits — no razorpay side-effects, no pending row, no
        // hint back to the caller. The dashboard / signed-in flow keeps its
        // real 409 because that caller is authenticated and already knows the
        // account exists.
        if (mode == Mode.TRIAL && signedInAccountId == null) {
            if (accountExistsByEmail(email)) {
                log.warn("subscription-signup TRIAL silently declined (enumeration guard) for email={}",
                        email);
                return ResponseEntity.ok(new SubscriptionSignupResponse(
                        /*pendingSignupId*/       null,
                        /*razorpaySubscriptionId*/null,
                        /*checkoutShortUrl*/      null,
                        /*mode*/                  mode.name(),
                        /*keyId*/                 null));
            }
        }
        // Signed-in caller must not start ANOTHER trial. They add a paid workspace.
        if (mode == Mode.TRIAL && signedInAccountId != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Your account already exists. Create a paid workspace instead.");
        }

        // ------- 2b. subdomain-taken guard -----------------------------------
        // A tenant with this subdomain (case-insensitive) that is still ACTIVE
        // means the signup would create a Razorpay subscription for a slot the
        // caller can never actually get — reject up front rather than let them
        // pay and then hit "already reserved" at provisioning time (whose
        // handling downgrades to "That workspace address was just taken. Please
        // cancel and pick a different one." — a much worse UX after money has
        // moved).
        String requestedSubdomain = normSubdomain(req.subdomain());
        if (requestedSubdomain != null && subdomainTaken(requestedSubdomain)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "SUBDOMAIN_TAKEN");
        }

        // ------- 3. plan validation (server-authoritative) -------------------
        if (req.planKeys() == null || req.planKeys().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one module");
        }
        // requireAvailable will throw 400 on unknown / LAUNCHING_SOON keys.
        planService.requireAvailable(req.planKeys());
        BillingCycle cycle = BillingCycle.from(req.billingCycle());
        int seats = req.seats() == null ? 1 : Math.max(1, req.seats());

        // ------- 4. hash password (never persist plaintext) ------------------
        // For signed-in adds we don't need a password; keep null in pending row.
        String passwordHash = signedInAccountId != null
                ? null
                : passwords.hash(requirePassword(req.password()));

        // ------- 5. create the Razorpay subscription -------------------------
        Instant startAt = mode == Mode.TRIAL
                ? Instant.now().plusSeconds(TRIAL_DAYS * 24 * 3600)
                : null;

        SubscriptionService.CreateSubscriptionResult rzp = subscriptions.createSubscription(
                req.planKeys(), seats, cycle, req.subdomain(), email,
                startAt, /*pendingSignupId not known yet — filled via notes below*/ null);

        // We need pending_signup_id in Razorpay notes for webhook lookup, but the
        // id is only assigned when we insert. Two options:
        //   (a) generate the UUID here, insert row, then re-open the subscription
        //       to patch notes (Razorpay does not support notes update — no).
        //   (b) look up pending_signups by razorpay_subscription_id in the webhook
        //       (unique index guarantees exactly one row). Simple and reliable.
        // We use (b): the webhook resolves via razorpay_subscription_id first,
        // then falls back to notes.pending_signup_id if some proxy strips notes.

        // ------- 6. stash the pending signup ---------------------------------
        UUID pendingId;
        try {
            pendingId = pending.stash(new PendingSignupService.StashArgs(
                    mode.name(),
                    signedInAccountId,
                    email,
                    passwordHash,
                    norm(req.adminMobile()),
                    req.adminName(),
                    req.companyName(),
                    normSubdomain(req.subdomain()),
                    req.country(),
                    req.timezone(),
                    req.currency() == null ? "INR" : req.currency(),
                    req.language(),
                    req.planKeys(),
                    seats,
                    cycle == BillingCycle.ANNUAL ? "yearly" : "monthly",
                    req.pan(),
                    req.gstin(),
                    req.addressLine1(),
                    req.addressLine2(),
                    req.city(),
                    req.state(),
                    req.postalCode(),
                    rzp.subscriptionId(),
                    /*customerId*/ null,
                    rzp.shortUrl()));
        } catch (ResponseStatusException e) {
            // Rollback the Razorpay subscription so a failed stash doesn't leave
            // an orphaned "created" subscription that Razorpay could try to charge
            // on the trial-end day (which would generate a webhook for a signup
            // we never persisted).
            subscriptions.cancelPreAuth(rzp.subscriptionId());
            throw e;
        }

        log.info("subscription-signup {}  mode={} sub={} pending={} startAt={}",
                email, mode, rzp.subscriptionId(), pendingId, startAt);

        return ResponseEntity.ok(new SubscriptionSignupResponse(
                pendingId,
                rzp.subscriptionId(),
                rzp.shortUrl(),
                mode.name(),
                rzp.keyId()));
    }

    /**
     * Polling endpoint for the frontend after the customer returns from
     * Razorpay. Reports whether the mandate is still awaiting authentication,
     * has been provisioned into a workspace, or terminally failed.
     */
    @GetMapping("/status")
    public PendingSignupStatusResponse status(@RequestParam("pendingSignupId") UUID pendingSignupId) {
        PendingSignupService.PendingSignup p = pending.findById(pendingSignupId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown signup"));
        String workspaceUrl = p.tenantId() != null
                ? "https://" + p.subdomain() + "." + baseDomain()
                : null;
        return new PendingSignupStatusResponse(
                p.status(), p.tenantId(), workspaceUrl, p.subdomain(),
                humaniseFailureReason(p.status(), p.failureReason()));
    }

    /**
     * Translate the raw failure_reason we recorded (which usually starts with
     * "provisioning failed: PSQLException ...") into something safe to show a
     * customer waiting on a spinner. The raw text stays in the DB for ops;
     * this method only shapes the wire response.
     *
     * <p>We match on well-known substrings first (RLS violation, duplicate
     * subdomain, check-constraint), and fall back to a generic message
     * otherwise. Never returns null when {@code status='FAILED'} — the
     * frontend uses non-null failureReason as its "show the error" signal.
     */
    static String humaniseFailureReason(String status, String rawReason) {
        if (!"FAILED".equals(status)) return null;
        if (rawReason == null || rawReason.isBlank()) {
            return "We couldn't finish creating your workspace. Our team has been notified — please try again in a few minutes or contact support@unifiedtree.com.";
        }
        String lower = rawReason.toLowerCase(Locale.ROOT);
        if (lower.contains("already reserved") || lower.contains("duplicate key") || lower.contains("unique constraint")) {
            return "That workspace address was just taken. Please cancel and pick a different one.";
        }
        if (lower.contains("row-level security") || lower.contains("row level security") || lower.contains("violates row-level")) {
            return "We hit a permissions error while creating your workspace. Support has been notified — please contact support@unifiedtree.com.";
        }
        if (lower.contains("check constraint") || lower.contains("violates check")) {
            return "Some of the details you entered don't fit our billing rules. Please cancel and re-try, or contact support@unifiedtree.com if the problem persists.";
        }
        if (lower.contains("timeout") || lower.contains("timed out") || lower.contains("connection")) {
            return "The payment provider took too long to confirm your mandate. Please try the signup again — your card was not charged.";
        }
        return "We couldn't finish creating your workspace. Our team has been notified — please try again in a few minutes or contact support@unifiedtree.com.";
    }

    /**
     * User-initiated cancel. Called by the frontend when the visitor clicks
     * "Cancel and edit my details" during the mandate-waiting overlay, OR
     * when they submit the form with fresh values while an earlier
     * {@code pendingSignupId} is still open.
     *
     * <p>Effect (only meaningful while status = AWAITING_MANDATE):
     * <ul>
     *   <li>Cancels the Razorpay subscription — {@link SubscriptionService#cancelPreAuth}
     *       tells Razorpay to withdraw the mandate registration. Without this
     *       step the UPI app sees a stale mandate request from us and refuses
     *       to register a new one with "Autopay already exists".</li>
     *   <li>Flips {@code platform.pending_signups.status} to CANCELLED, which
     *       releases the partial UNIQUE index on
     *       {@code lower(subdomain) WHERE status='AWAITING_MANDATE'} — the
     *       subdomain becomes available for the next attempt immediately.</li>
     * </ul>
     *
     * <p>Idempotent: PROVISIONED / FAILED / CANCELLED / EXPIRED rows are no-ops
     * (200 OK) so the browser can safely retry.
     */
    @PostMapping("/cancel")
    public ResponseEntity<CancelResponse> cancel(@RequestBody CancelRequest req) {
        if (req == null || req.pendingSignupId() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "pendingSignupId is required");
        }
        PendingSignupService.PendingSignup p = pending.findById(req.pendingSignupId()).orElse(null);
        if (p == null) {
            // Idempotent: unknown id likely means the browser already succeeded
            // in cancelling and lost track. Don't 404 — the caller just wants
            // to be sure the row is dead.
            return ResponseEntity.ok(new CancelResponse("ALREADY_GONE", null));
        }
        if (!"AWAITING_MANDATE".equals(p.status())) {
            // Already terminal — nothing more to do, and definitely don't try
            // to cancel a subscription that's ACTIVE / CHARGED / PROVISIONED.
            return ResponseEntity.ok(new CancelResponse("NOOP_" + p.status(), p.subdomain()));
        }

        // Best-effort Razorpay cancel — logs + swallows on error inside
        // cancelPreAuth so a Razorpay-side hiccup doesn't leave our row stuck.
        subscriptions.cancelPreAuth(p.razorpaySubscriptionId());
        pending.markCancelled(p.id());
        log.info("subscription-signup cancel  pending={} razorpay_sub={} subdomain={}",
                p.id(), p.razorpaySubscriptionId(), p.subdomain());
        return ResponseEntity.ok(new CancelResponse("CANCELLED", p.subdomain()));
    }

    // -- helpers --------------------------------------------------------------

    private String baseDomain() {
        // Cheap fallback; the real value comes from unifiedtree.base-domain via
        // SaasService but we don't need to inject the whole thing.
        return "unifiedtree.com";
    }

    private String requirePassword(String pw) {
        if (pw == null || pw.length() < 8) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Password is required (min 8 characters)");
        }
        return pw;
    }

    private static String norm(String s) {
        return s == null ? null : s.trim();
    }

    /**
     * Best-effort client-IP resolution. Prefers the leftmost address in
     * {@code X-Forwarded-For} (Cloud Run injects it), else the servlet's
     * {@code getRemoteAddr()}. Returns null on total failure so the limiter
     * simply skips the IP key rather than erroring out the signup.
     */
    private static String clientIp(HttpServletRequest req) {
        if (req == null) return null;
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            String first = (comma > 0 ? xff.substring(0, comma) : xff).trim();
            if (!first.isEmpty()) return first;
        }
        return req.getRemoteAddr();
    }

    private static String normSubdomain(String s) {
        return s == null ? null : s.trim().toLowerCase(Locale.ROOT);
    }

    private boolean accountExistsByEmail(String email) {
        try {
            Integer n = jdbc.queryForObject(
                    "SELECT 1 FROM platform.accounts WHERE lower(email) = ? LIMIT 1",
                    Integer.class, email.toLowerCase(Locale.ROOT));
            return n != null;
        } catch (EmptyResultDataAccessException e) {
            return false;
        }
    }

    /**
     * True if an ACTIVE tenant with this subdomain already exists. Only
     * ACTIVE tenants are considered — a SUSPENDED / TERMINATED row that has
     * released the slug (or is about to) shouldn't block a new signup, and a
     * partial-index on lower(subdomain) WHERE status='ACTIVE' at the DB level
     * mirrors this check on the write side.
     */
    private boolean subdomainTaken(String subdomainLower) {
        try {
            Integer n = jdbc.queryForObject(
                    "SELECT 1 FROM platform.tenants "
                            + "WHERE lower(subdomain) = ? AND status = 'ACTIVE' LIMIT 1",
                    Integer.class, subdomainLower);
            return n != null;
        } catch (EmptyResultDataAccessException e) {
            return false;
        } catch (Exception e) {
            // Fail OPEN — an intermittent DB blip should not stop paying customers
            // from starting a signup. The unique index at insert time is the
            // real backstop.
            log.warn("subdomain-taken check failed for '{}' — allowing signup to proceed", subdomainLower, e);
            return false;
        }
    }

    private static UUID accountIdFromJwt(Jwt jwt) {
        // Same claim name our other endpoints (e.g. AccountService) read.
        Object v = jwt.getClaim("account_id");
        if (v == null) v = jwt.getClaim("accountId");
        if (v == null) return null;
        try { return UUID.fromString(v.toString()); } catch (Exception e) { return null; }
    }

    private enum Mode {
        TRIAL, PAID;
        static Mode from(String s) {
            if (s == null) return PAID;
            try { return Mode.valueOf(s.trim().toUpperCase(Locale.ROOT)); }
            catch (Exception e) { return PAID; }
        }
    }

    // -- DTOs -----------------------------------------------------------------

    /**
     * The unified signup form payload. Same shape for TRIAL and PAID; the
     * {@code mode} field decides how the backend routes the request.
     * Company/tax fields (pan/gstin/address*) are optional and never
     * validated for format server-side — the frontend soft-warns instead.
     */
    public record SubscriptionSignupRequest(
            @NotBlank @Size(max = 8)  String mode,            // 'TRIAL' | 'PAID'

            @NotBlank @Size(max = 150) String companyName,
            @NotBlank @Size(min = 3, max = 63) String subdomain,
            @NotBlank @Size(max = 150) String adminName,
            @NotBlank @Email @Size(max = 255) String adminEmail,
            @Size(max = 20)  String adminMobile,

            // Optional (nullable) when the caller is signed in (JWT present)
            // — the endpoint enforces "present iff no JWT" at request time.
            @Size(min = 8, max = 128) String password,

            @Size(max = 50)  String country,
            @Size(max = 50)  String timezone,
            @Size(max = 10)  String currency,
            @Size(max = 30)  String language,

            @NotEmpty List<String> planKeys,
            @Min(1) Integer seats,
            @Size(max = 16) String billingCycle,   // 'monthly' | 'yearly'

            // Optional company / tax details — pass through to platform.tenants.
            @Size(max = 20)  String pan,
            @Size(max = 20)  String gstin,
            @Size(max = 255) String addressLine1,
            @Size(max = 255) String addressLine2,
            @Size(max = 100) String city,
            @Size(max = 100) String state,
            @Size(max = 20)  String postalCode
    ) {}

    public record SubscriptionSignupResponse(
            UUID pendingSignupId,
            String razorpaySubscriptionId,
            String checkoutShortUrl,
            String mode,
            String keyId
    ) {}

    public record PendingSignupStatusResponse(
            String status,          // AWAITING_MANDATE | PROVISIONED | FAILED | EXPIRED | CANCELLED
            UUID tenantId,
            String workspaceUrl,
            String subdomain,
            String failureReason
    ) {}

    public record CancelRequest(UUID pendingSignupId) {}
    /**
     * status one of:
     *   CANCELLED       — we did the work (cancelled Razorpay + freed subdomain)
     *   NOOP_&lt;prev&gt;    — row was already terminal (prev = PROVISIONED/FAILED/EXPIRED/CANCELLED)
     *   ALREADY_GONE    — pendingSignupId not found in DB
     */
    public record CancelResponse(String status, String subdomain) {}
}
