package com.unifiedtree.saas.signup;

import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.payment.subscription.SubscriptionService;
import com.unifiedtree.saas.plans.BillingCycle;
import com.unifiedtree.saas.plans.ModulePlanService;
import com.unifiedtree.saas.service.SaasService;
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

    public SubscriptionSignupController(SubscriptionService subscriptions,
                                        PendingSignupService pending,
                                        PasswordService passwords,
                                        ModulePlanService planService,
                                        JdbcTemplate jdbc,
                                        RazorpayProperties props) {
        this.subscriptions = subscriptions;
        this.pending = pending;
        this.passwords = passwords;
        this.planService = planService;
        this.jdbc = jdbc;
        this.props = props;
    }

    @PostMapping
    public ResponseEntity<SubscriptionSignupResponse> signup(
            @Valid @RequestBody SubscriptionSignupRequest req,
            @AuthenticationPrincipal Jwt jwt) {

        if (!props.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Payment gateway is not configured");
        }

        // ------- 1. mode + JWT-based account resolution -----------------------
        Mode mode = Mode.from(req.mode());
        UUID signedInAccountId = jwt == null ? null : accountIdFromJwt(jwt);
        String email = norm(req.adminEmail());

        // ------- 2. duplicate-email guard (TRIAL only, when NOT signed in) ---
        // Anon TRIAL signup: reject if email already has an account. Signed-in
        // caller means the account already exists by definition — reusing the
        // trial slot must NOT be allowed either, but that's caught below by
        // checking their workspaces count via a separate signed-in guard.
        if (mode == Mode.TRIAL && signedInAccountId == null) {
            if (accountExistsByEmail(email)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "This email has already claimed the free trial. Please sign in and create a paid workspace instead.");
            }
        }
        // Signed-in caller must not start ANOTHER trial. They add a paid workspace.
        if (mode == Mode.TRIAL && signedInAccountId != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Your account already exists. Create a paid workspace instead.");
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
                p.failureReason());
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
}
