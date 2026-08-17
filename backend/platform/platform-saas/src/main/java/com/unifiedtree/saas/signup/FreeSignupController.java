package com.unifiedtree.saas.signup;

import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.service.SaasService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Public "Create Free Workspace" endpoint.
 *
 * <p>Contrast with {@link SubscriptionSignupController} which does the paid /
 * autopay signup and requires a Razorpay mandate before it will provision
 * anything. This endpoint is synchronous and free:
 *
 * <ol>
 *   <li>Validate the payload.</li>
 *   <li>Resolve the account — signed-in caller uses their JWT account_id,
 *       anon caller uses email+password (existing account with matching
 *       password → reuse; new email → mint a new account).</li>
 *   <li>Create the workspace via {@link SaasService#createFreeWorkspace}
 *       with ZERO active modules — every module renders as locked in the
 *       workspace until the admin opens {@code /plan} and sets up autopay.</li>
 *   <li>Return {@code tenantId + subdomain + workspaceUrl + email} so the
 *       browser can auto-login and redirect the user straight into their
 *       new workspace.</li>
 * </ol>
 *
 * <p>Multiple free workspaces per account are supported. There is NO
 * "one free per email" cap — the client explicitly wants users to be able
 * to create as many free workspaces as they need. The 7-day trial is
 * per-workspace, not per-email, and it starts LATER (when autopay is set
 * up inside the workspace), not at creation time.
 */
@RestController
@RequestMapping("/v1/public/free-signup")
public class FreeSignupController {

    private static final Logger log = LoggerFactory.getLogger(FreeSignupController.class);

    private final SaasService saas;
    private final PasswordService passwords;
    private final PublicEndpointRateLimiter rateLimiter;

    public FreeSignupController(SaasService saas,
                                PasswordService passwords,
                                PublicEndpointRateLimiter rateLimiter) {
        this.saas = saas;
        this.passwords = passwords;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping
    public ResponseEntity<FreeSignupResponse> signup(
            @Valid @RequestBody FreeSignupRequest req,
            @AuthenticationPrincipal Jwt jwt,
            HttpServletRequest http) {

        String email = norm(req.adminEmail());

        // ── Bundle B4: per-email + per-ip in-memory rate-limit ──────────────
        // 5 / 15min per email, 20 / 15min per ip. Throws 429 HrmsException on
        // exhaustion. Runs BEFORE any password / DB work so a flood cannot
        // touch the account row.
        rateLimiter.check("free-signup", clientIp(http), email);

        UUID signedInAccountId = jwt == null ? null : accountIdFromJwt(jwt);

        // Resolve account:
        //   - signed-in caller → use the JWT account, no password needed
        //   - anon caller     → email+password path in SaasService (existing
        //                       account with matching password → reuse;
        //                       else mint a new UUID for SaasWriter to insert;
        //                       wrong password → Optional.empty(), see below).
        UUID accountId;
        String passwordHash;
        if (signedInAccountId != null) {
            accountId    = signedInAccountId;
            passwordHash = null;
        } else {
            String plaintext = req.password();
            if (plaintext == null || plaintext.length() < 8) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Password is required (min 8 characters)");
            }
            // Bundle B4 D2 — resolveOrCreateAccountIdSafe returns empty when
            // the email is claimed by a different password. Do NOT throw 409
            // here (that would be an account-enumeration oracle: attacker
            // asks "does this email exist?" and the status code answers).
            // Instead return the SAME 200-shaped response we'd send on a
            // brand-new signup, with tenantId/subdomain nulled out so the
            // frontend shows a generic "check your inbox" affordance.
            Optional<UUID> resolved = saas.resolveOrCreateAccountIdSafe(email, plaintext);
            if (resolved.isEmpty()) {
                log.warn("free-signup silently blocked (enumeration guard) for email={}", email);
                return ResponseEntity.ok(new FreeSignupResponse(
                        /*tenantId*/     null,
                        /*subdomain*/    null,
                        /*workspaceUrl*/ null,
                        email));
            }
            accountId    = resolved.get();
            passwordHash = passwords.hash(plaintext);
        }

        SignupResponse resp = saas.createFreeWorkspace(
                accountId,
                passwordHash,
                req.companyName(),
                req.subdomain(),
                req.adminName(),
                email,
                norm(req.adminMobile()),
                req.country(),
                req.timezone(),
                req.currency() == null ? "INR" : req.currency());

        log.info("free-signup {} → tenant={} subdomain={} signedIn={}",
                email, resp.tenantId(), resp.subdomain(), signedInAccountId != null);

        // B7 FIX (audit 2026-08-15): return identical response shape for
        // existing-email (enumeration guard branch above) vs fresh-email
        // anonymous callers. Both paths now omit tenantId/subdomain/URL and
        // rely on the welcome email (fired by the workspace-created event
        // pipeline) to hand the customer the actual workspace link. Signed-in
        // callers still get the direct redirect payload — for them there is
        // no enumeration risk (they already know their own account exists).
        if (signedInAccountId != null) {
            return ResponseEntity.ok(new FreeSignupResponse(
                    resp.tenantId(),
                    resp.subdomain(),
                    resp.workspaceUrl(),
                    email));
        }
        return ResponseEntity.ok(new FreeSignupResponse(
                /*tenantId*/     null,
                /*subdomain*/    null,
                /*workspaceUrl*/ null,
                email));
    }

    // -- helpers --------------------------------------------------------------

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

    private static UUID accountIdFromJwt(Jwt jwt) {
        // Same claim name our other endpoints (e.g. AccountService) read.
        Object v = jwt.getClaim("account_id");
        if (v == null) v = jwt.getClaim("accountId");
        if (v == null) return null;
        try { return UUID.fromString(v.toString()); } catch (Exception e) { return null; }
    }

    // -- DTOs -----------------------------------------------------------------

    /**
     * Minimal free-signup payload. NO planKeys, NO seats, NO billingCycle —
     * those are picked inside the workspace when the admin sets up autopay.
     */
    public record FreeSignupRequest(
            @NotBlank @Size(max = 150) String companyName,
            @NotBlank @Size(min = 3, max = 63) String subdomain,
            @NotBlank @Size(max = 150) String adminName,
            @NotBlank @Email @Size(max = 255) String adminEmail,
            @Size(max = 20)  String adminMobile,

            // Optional (nullable) when the caller is signed in (JWT present)
            // — enforced at request time.
            @Size(min = 8, max = 128) String password,

            @Size(max = 50)  String country,
            @Size(max = 50)  String timezone,
            @Size(max = 10)  String currency
    ) {
        public FreeSignupRequest {
            // Normalise subdomain to lower-case so downstream uniqueness
            // checks + tenant_domains row are consistent.
            if (subdomain != null) subdomain = subdomain.trim().toLowerCase(Locale.ROOT);
        }
    }

    /**
     * Bundle B4 D2 — tenantId/subdomain/workspaceUrl are nullable now. The
     * silent-decline branch (enumeration guard) returns them as null; the
     * SPA treats a null tenantId as "check your inbox for confirmation"
     * instead of auto-redirecting into the workspace.
     */
    public record FreeSignupResponse(
            UUID tenantId,
            String subdomain,
            String workspaceUrl,
            String email
    ) {}
}
